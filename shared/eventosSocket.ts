// Eventos em tempo real com dados (os avisos de lista mudada estão em escopos.ts). Mesmo nome e formato nos dois lados.

/** Cliente respondeu "Não poderei ir" ao lembrete do WhatsApp */
export const EVENTO_CLIENTE_AUSENTE = 'cliente_ausente';
export type AvisoAusencia = { agendamentoId: string; cliente: string; data: string; horario: string; colaboradorId: string };
