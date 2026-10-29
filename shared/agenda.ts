/**
 * Regras de agenda compartilhadas entre backend (API interna e totem) e frontend.
 * Alterar aqui muda o comportamento dos dois lados ao mesmo tempo.
 */

export const FUSO_HORARIO = 'America/Sao_Paulo';
export const HORA_ABERTURA = 9;
export const HORA_FECHAMENTO = 21;
export const INTERVALO_AGENDAMENTO_MIN = 15;
export const INTERVALO_SLOT_TOTEM_MIN = 30;
export const DURACAO_PADRAO_MIN = 60;
// Turno usado quando um dia vira "trabalho" sem turno definido (ex.: troca de turno aprovada)
export const TURNO_PADRAO = '08:00-18:00';
export const TURNO_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
export const HORA_ABERTURA_TEXTO = `${String(HORA_ABERTURA).padStart(2, '0')}:00`;
export const HORA_FECHAMENTO_TEXTO = `${String(HORA_FECHAMENTO).padStart(2, '0')}:00`;

export type ServicoComDuracao = { duracao?: number | null; tempoHigienizacaoMin?: number | null };

// Tempo que um serviço ocupa na agenda: atendimento + higienização da sala
export const duracaoServico = (servico?: ServicoComDuracao | null) =>
  (Number(servico?.duracao) || DURACAO_PADRAO_MIN) + (Number(servico?.tempoHigienizacaoMin) || 0);

export const duracaoTotal = (servicos: ServicoComDuracao[] = []) =>
  servicos.length > 0 ? servicos.reduce((total, servico) => total + duracaoServico(servico), 0) : DURACAO_PADRAO_MIN;

export const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const horarioParaMinutos = (horario: string) => {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + m;
};

export const minutosParaHorario = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

export const dataValida = (data: unknown): data is string => {
  if (typeof data !== 'string' || !DATA_REGEX.test(data)) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
};

export const horarioValido = (horario: unknown): horario is string =>
  typeof horario === 'string' && HORARIO_REGEX.test(horario);

// Data (YYYY-MM-DD) e minutos desde a meia-noite no fuso do negócio
export const partesNoFuso = (instante: Date) => {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_HORARIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante).map((p) => [p.type, p.value]));
  const horario = `${partes.hour}:${partes.minute}`;
  return { data: `${partes.year}-${partes.month}-${partes.day}`, horario, minutos: horarioParaMinutos(horario) };
};

// Converte data + horário locais (Brasília) para o instante UTC correspondente
export const instanteNoFuso = (data: string, horario: string): Date => {
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, m] = horario.split(':').map(Number);
  const palpite = Date.UTC(ano, mes - 1, dia, h, m);
  // Descobre o deslocamento do fuso naquele instante (sem horário de verão hoje, mas robusto se voltar)
  const local = partesNoFuso(new Date(palpite));
  const [la, lm, ld] = local.data.split('-').map(Number);
  const localComoUtc = Date.UTC(la, lm - 1, ld, Math.floor(local.minutos / 60), local.minutos % 60);
  return new Date(palpite + (palpite - localComoUtc));
};

/**
 * Valida início e duração de um agendamento. Retorna a mensagem de erro ou null.
 * `agora` permite recusar horários que já passaram.
 */
export const validarHorarioAgendamento = (
  data: string,
  horario: string,
  duracaoMin: number,
  { agora, intervaloMin = INTERVALO_AGENDAMENTO_MIN }: { agora?: Date; intervaloMin?: number } = {},
): string | null => {
  if (!dataValida(data) || !horarioValido(horario)) return 'Data ou horário inválido.';
  if (!Number.isFinite(duracaoMin) || duracaoMin <= 0) return 'Duração do atendimento inválida.';

  const inicio = horarioParaMinutos(horario);
  if (inicio < HORA_ABERTURA * 60 || inicio >= HORA_FECHAMENTO * 60) {
    return `Agendamentos só podem começar entre ${HORA_ABERTURA_TEXTO} e ${HORA_FECHAMENTO_TEXTO}.`;
  }
  if (inicio % intervaloMin !== 0) {
    return `Os horários devem ser múltiplos de ${intervaloMin} minutos (ex.: 10:00, ${minutosParaHorario(10 * 60 + intervaloMin)}).`;
  }
  if (inicio + duracaoMin > HORA_FECHAMENTO * 60) {
    return `Este agendamento termina depois do fechamento (${HORA_FECHAMENTO_TEXTO}). Escolha um horário mais cedo.`;
  }
  if (agora) {
    const atual = partesNoFuso(agora);
    if (data < atual.data || (data === atual.data && inicio < atual.minutos)) {
      return 'Não é possível agendar em um horário que já passou.';
    }
  }
  return null;
};

export const intervalosSobrepoem = (inicioA: number, fimA: number, inicioB: number, fimB: number) =>
  inicioA < fimB && inicioB < fimA;
