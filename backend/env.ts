// Carrega o .env da raiz antes de qualquer outro módulo (imports ESM rodam em ordem)
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const producao = process.env.NODE_ENV === 'production';

// URL de integração externa (gateway, WhatsApp): vazia desliga. Em produção só HTTPS, porque leva token e dados de cliente
const lerUrlIntegracao = (nome: string): string => {
  const valor = (process.env[nome] || '').trim();
  if (!valor) return '';
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    // Sem repetir o valor: a URL pode trazer credencial (usuário:senha@ ou ?token=) e iria para o log do boot
    throw new Error(`${nome} inválida: informe uma URL completa (https://...).`);
  }
  if (url.protocol !== 'https:' && (producao || url.protocol !== 'http:')) throw new Error(`${nome} precisa usar https://.`);
  return url.toString();
};

// Validade do token: "30m", "2h", "1d" ou segundos. Nunca passa de 12h (token não é revogável antes de expirar).
const JWT_EXPIRES_MAX_SEGUNDOS = 12 * 60 * 60;
const lerValidadeToken = (valor: string | undefined): number => {
  const texto = (valor || '2h').trim();
  const casamento = /^(\d+)\s*([smhd]?)$/i.exec(texto);
  if (!casamento) throw new Error(`JWT_EXPIRES_IN inválido ("${texto}"). Use, por exemplo, 30m, 2h ou 7200.`);
  const fator = { '': 1, s: 1, m: 60, h: 3600, d: 86_400 }[casamento[2].toLowerCase() as '' | 's' | 'm' | 'h' | 'd'];
  return Math.min(Number(casamento[1]) * fator, JWT_EXPIRES_MAX_SEGUNDOS);
};

// TRUST_PROXY aceita só número de saltos (1, 2) ou lista de IPs/sub-redes; "true" deixaria o cliente forjar o IP
const lerTrustProxy = (valor: string | undefined): number | string[] | undefined => {
  const texto = (valor || '').trim();
  if (!texto) return undefined;
  if (/^\d+$/.test(texto)) return Number(texto);
  if (/^(true|false|yes|no)$/i.test(texto)) {
    throw new Error('TRUST_PROXY não aceita "true": informe o número de proxies (ex.: 1) ou os IPs deles.');
  }
  return texto.split(',').map((ip) => ip.trim()).filter(Boolean);
};

// Limite numérico: inteiro maior que zero, senão o padrão (um negativo travaria todo login com 429)
const inteiroPositivo = (valor: string | undefined, padrao: number) => {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : padrao;
};

// Configuração lida uma vez; o restante do servidor usa este objeto em vez de process.env
export const config = {
  producao,
  porta: Number(process.env.PORT) || 3333,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  trustProxy: lerTrustProxy(process.env.TRUST_PROXY),
  jwtExpiraEmSegundos: lerValidadeToken(process.env.JWT_EXPIRES_IN),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  limpezaAgendamentosDias: Number(process.env.LIMPEZA_AGENDAMENTOS_DIAS ?? 30),
  totemMaxReservasPorIp: Number(process.env.TOTEM_MAX_RESERVAS_POR_IP) || 5,
  // Teto diário por IP: o de 10 min sozinho deixa um robô lotar a agenda num dia. O totem da recepção (todos os
  // clientes atrás do mesmo IP) pode precisar de um valor maior
  totemMaxReservasPorIpDia: inteiroPositivo(process.env.TOTEM_MAX_RESERVAS_POR_IP_DIA, 40),
  // Erros de login por IP antes do bloqueio de 15 min (no CI todos os testes saem do mesmo IP)
  loginMaxTentativasIp: inteiroPositivo(process.env.LOGIN_MAX_TENTATIVAS_IP, 60),
  // Desafios de prova de trabalho emitidos por IP por minuto (toda uma recepção atrás do mesmo IP divide este teto)
  loginMaxDesafiosPorMinutoIp: inteiroPositivo(process.env.LOGIN_MAX_DESAFIOS_POR_MINUTO_IP, 120),
  totemMaxRequisicoesPorMinuto: Number(process.env.TOTEM_MAX_REQUISICOES_POR_MINUTO) || 60,
  pagamentoWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
  pagamentoGatewayUrl: lerUrlIntegracao('PAYMENT_GATEWAY_URL'),
  pagamentoGatewayToken: process.env.PAYMENT_GATEWAY_TOKEN || '',
  whatsappUrl: lerUrlIntegracao('WHATSAPP_WEBHOOK_URL'),
  whatsappToken: process.env.WHATSAPP_WEBHOOK_TOKEN || '',
};

// Em produção, falha no boot em vez de rodar com padrões pensados para a rede local de desenvolvimento
// Banco fora desta máquina sem NODE_ENV definido quase sempre é produção esquecida: o servidor subiria com CORS
// aberto para a rede local e limites de login em memória (zeram a cada restart). Ambiente de desenvolvimento
// com banco remoto declara NODE_ENV=development.
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const bancoRemoto = () => {
  try {
    return !HOSTS_LOCAIS.has(new URL(process.env.DATABASE_URL || '').hostname);
  } catch {
    return false;
  }
};

const AMBIENTES_CONHECIDOS = new Set(['production', 'development', 'test']);

export const validarConfigProducao = (): string[] => {
  if (!producao) {
    const ambiente = process.env.NODE_ENV;
    // "prod", "staging" etc. cairiam no modo de desenvolvimento (CORS aberto, limites em memória) sem avisar
    if (ambiente && !AMBIENTES_CONHECIDOS.has(ambiente)) {
      return [`NODE_ENV="${ambiente}" não é reconhecido. Use production, development ou test.`];
    }
    return !ambiente && bancoRemoto()
      ? ['NODE_ENV não definido com banco remoto. Use NODE_ENV=production no servidor (ou NODE_ENV=development para desenvolver com banco remoto).']
      : [];
  }
  const erros: string[] = [];
  if (config.corsOrigins.length === 0) erros.push('CORS_ORIGINS é obrigatório em produção (ex.: https://app.suaempresa.com).');
  if (!process.env.REDIS_URL) erros.push('REDIS_URL é obrigatório em produção (limites de tentativas e travas do totem).');
  // Valores do CI (1000) copiados para o servidor deixariam a força bruta por IP praticamente livre
  if (config.loginMaxTentativasIp > 200) erros.push('LOGIN_MAX_TENTATIVAS_IP acima de 200 não é aceito em produção.');
  if (config.loginMaxDesafiosPorMinutoIp > 300) erros.push('LOGIN_MAX_DESAFIOS_POR_MINUTO_IP acima de 300 não é aceito em produção.');
  // Sem token, o servidor subiria e só falharia (401 do provedor) com o cliente na frente do totem
  if (config.pagamentoGatewayUrl && !config.pagamentoGatewayToken) erros.push('PAYMENT_GATEWAY_TOKEN é obrigatório quando PAYMENT_GATEWAY_URL está definida.');
  if (config.whatsappUrl && !config.whatsappToken) erros.push('WHATSAPP_WEBHOOK_TOKEN é obrigatório quando WHATSAPP_WEBHOOK_URL está definida.');
  return erros;
};
