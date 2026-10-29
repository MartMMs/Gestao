import { normalizarTexto } from '@shared/validadores';

export const formatPhone = (value: string) => {
  // Valores mascarados pela API ("(11) *****-**21") são exibidos como vieram
  if (!value || value.includes('*')) return value;
  let digits = value.replace(/[^\d]/g, '');
  // Remove o DDI do Brasil (+55) quando o número vem completo
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  const phoneNumber = digits.slice(0, 11);
  const phoneNumberLength = phoneNumber.length;

  if (phoneNumberLength <= 2) return phoneNumber;
  if (phoneNumberLength <= 6) return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2)}`;
  if (phoneNumberLength <= 10) return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2, 6)}-${phoneNumber.slice(6)}`;
  return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2, 7)}-${phoneNumber.slice(7)}`;
};

export const formatCpf = (value: string) => {
  if (!value || value.includes('*')) return value;
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

export const formatDuration = (minutes: number) => {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

// Profissionais que atendem clientes (admins e supervisores não entram nas grades de atendimento)
export const isTeamMember = (employee: { role: string }) => employee.role === 'collaborator';

// Senha provisória forte para novos colaboradores (mostrada uma única vez ao supervisor)
export const gerarSenhaProvisoria = () => {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
};

// E-mail de acesso gerado a partir do nome; homônimos recebem sufixo numérico (ana.silva2@...)
export const gerarEmailUnico = (nomeCompleto: string, emailsExistentes: string[], dominio = 'serenidade.com') => {
  const partes = normalizarTexto(nomeCompleto)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const base = partes.length > 1 ? `${partes[0]}.${partes[partes.length - 1]}` : partes[0] || 'colaborador';
  const usados = new Set(emailsExistentes.map((e) => e.toLowerCase()));
  let email = `${base}@${dominio}`;
  for (let n = 2; usados.has(email); n += 1) email = `${base}${n}@${dominio}`;
  return email;
};
