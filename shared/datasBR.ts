// Datas e horas no fuso do negócio (Brasília), num lugar só para o servidor e a tela
import { FUSO_HORARIO as FUSO_NEGOCIO } from './agenda';

export { FUSO_NEGOCIO };

export const formatarBR = (data: Date, opcoes: Intl.DateTimeFormatOptions) => data.toLocaleString('pt-BR', { timeZone: FUSO_NEGOCIO, ...opcoes });
/** 10:30 */
export const horaDe = (data: Date) => formatarBR(data, { hour: '2-digit', minute: '2-digit' });
/** AAAA-MM-DD do dia em Brasília */
export const diaISODe = (data: Date) => data.toLocaleDateString('sv-SE', { timeZone: FUSO_NEGOCIO });

// ---- Exibição ao usuário: sempre DD/MM/AAAA. Banco, API e <input type="date"> continuam em AAAA-MM-DD ----
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEMANA_CURTA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// AAAA-MM-DD é lido direto (sem new Date em UTC, que recua um dia em Brasília); timestamp vai para o fuso do negócio
const paraDiaISO = (valor: string | Date | null | undefined): string | null => {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'string') {
    const m = DIA_ISO.exec(valor.trim());
    if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? valor.trim() : null;
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : diaISODe(d);
};

/** 23/11/2026 (vazio quando a entrada é inválida) */
export const formatarDataBR = (valor: string | Date | null | undefined) => {
  const iso = paraDiaISO(valor);
  return iso ? iso.split('-').reverse().join('/') : '';
};

/** 23/11/2026 09:00 (ou "23/11/2026 às 09:00" com comAs) — horário em Brasília */
export const formatarDataHoraBR = (valor: string | Date | null | undefined, opcoes?: { comAs?: boolean }) => {
  if (valor === null || valor === undefined || valor === '') return '';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime()) || (typeof valor === 'string' && DIA_ISO.test(valor.trim()))) return formatarDataBR(valor);
  return `${formatarDataBR(d)}${opcoes?.comAs ? ' às ' : ' '}${horaDe(d)}`;
};

/** seg, 23/11/2026 */
export const formatarDataComDiaSemanaBR = (valor: string | Date | null | undefined) => {
  const iso = paraDiaISO(valor);
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  return `${SEMANA_CURTA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${formatarDataBR(iso)}`;
};
