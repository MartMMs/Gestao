import { duracaoTotal, type ServicoComDuracao } from './agenda';

/**
 * Regras de status do atendimento compartilhadas entre API, relatório e telas.
 * Status nulo (registros antigos) vale como 'scheduled'.
 */

// Status de um atendimento que já recebeu baixa: é registro fechado (faturamento, comissão, falta) e só a
// observação muda nele
export const STATUS_FECHADOS = ['completed', 'no_show', 'cancelled'] as const;

export const statusFechado = (status: string | null | undefined) =>
  (STATUS_FECHADOS as readonly string[]).includes(status ?? 'scheduled');

// Códigos de erro estáveis (campo `code` da resposta): o front decide pelo código, não pelo texto
export const CODIGO_VERSAO_AUSENTE = 'VERSAO_AUSENTE';
export const CODIGO_VERSAO_DESATUALIZADA = 'VERSAO_DESATUALIZADA';
// O atendimento não é (mais) de quem tenta alterá-lo: por exemplo, foi passado para outro profissional
export const CODIGO_FORA_DA_AGENDA = 'FORA_DA_AGENDA';

/**
 * Atendimento "sem baixa": ainda agendado e com o fim (serviços + higienização) já no passado. Ninguém concluiu
 * nem marcou falta. Usada no relatório (e no dashboard, que lê o relatório) e nas visões de semana e mês; a grade
 * do dia aplica a mesma regra pelo dia e pelo relógio (ver ScheduleGridColumn).
 */
export const semBaixaVencido = (
  atendimento: { status: string | null | undefined; inicio: Date; servicos: ServicoComDuracao[] },
  agora: Date,
) => !statusFechado(atendimento.status) && atendimento.inicio.getTime() + duracaoTotal(atendimento.servicos) * 60_000 < agora.getTime();
