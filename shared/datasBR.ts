// Datas e horas no fuso do negócio (Brasília), num lugar só para o servidor e a tela
import { FUSO_HORARIO as FUSO_NEGOCIO } from './agenda';

export { FUSO_NEGOCIO };

export const formatarBR = (data: Date, opcoes: Intl.DateTimeFormatOptions) => data.toLocaleString('pt-BR', { timeZone: FUSO_NEGOCIO, ...opcoes });
/** 11/12 */
export const diaMesDe = (data: Date) => formatarBR(data, { day: '2-digit', month: '2-digit' });
/** 10:30 */
export const horaDe = (data: Date) => formatarBR(data, { hour: '2-digit', minute: '2-digit' });
/** 11/12/2026, 10:30 */
export const dataHoraDe = (data: Date) => formatarBR(data, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** AAAA-MM-DD do dia em Brasília */
export const diaISODe = (data: Date) => data.toLocaleDateString('sv-SE', { timeZone: FUSO_NEGOCIO });
