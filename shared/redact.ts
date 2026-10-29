// Mascara dados sensíveis (token, CPF, telefone, e-mail, senha, nome e dados de saúde) antes de registrar logs.
// Usado pelo backend (server.ts) e pelo frontend (api.ts).

const SENSITIVE_LOG_KEYS = [
  'token', 'authorization', 'cpf', 'telefone', 'contact', 'senha', 'password', 'email',
  // Dados pessoais e de saúde (LGPD): nome do cliente, anamnese e observações
  'nome', 'clientname', 'observ', 'saude', 'anamnese',
];

export const sanitizeSensitiveString = (value: string) => value
  .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**')
  .replace(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g, '(**) *****-****')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');

const isSensitiveKey = (key: string) => {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_LOG_KEYS.some((sensitiveKey) => normalizedKey.includes(sensitiveKey));
};

export const redactSensitiveData = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === 'string') {
    return sanitizeSensitiveString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, seen));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    const next: Record<string, unknown> = {};
    if (value instanceof Error) {
      next.name = value.name;
      // Erros do Prisma repetem na mensagem os argumentos da consulta (nome, anamnese...): só código e meta vão ao log
      if (value.name.startsWith('PrismaClient')) {
        next.message = '[consulta omitida do log]';
      } else {
        next.message = sanitizeSensitiveString(value.message || '');
        if (typeof value.stack === 'string') next.stack = sanitizeSensitiveString(value.stack);
      }
    }

    for (const [key, nested] of Object.entries(obj)) {
      if (key in next) continue;
      next[key] = isSensitiveKey(key) ? '[REDACTED]' : redactSensitiveData(nested, seen);
    }
    return next;
  }

  return value;
};
