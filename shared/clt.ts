/**
 * utils/cltValidator.ts
 * Validações de conformidade com a CLT baseadas na malha de escala.
 */

import { type DiaEscala } from './escala';
import { horarioParaMinutos } from './agenda';

export interface AnaliseConformidadeCLT {
  interjornada: {
    conforme: boolean;
    menorInterjornada: number; // em horas
    alertas: string[];
  };
  cargaSemanal: {
    conforme: boolean;
    cargaTotal: number; // em horas
    semanaAnalisada: string;
    alertas: string[];
  };
  descansoRemunerado: {
    conforme: boolean;
    ultimaFolga: string;
    diasSemFolga: number;
    alertas: string[];
  };
  statusGeral: boolean;
  resumo: string[];
}

export interface ViolacaoInterjornada {
  dataTurnoAnterior: string;
  dataTurnoAtual: string;
  descansoHoras: number;
  turnoAnterior: string;
  turnoAtual: string;
}

export interface ViolacaoSetimoDia {
  data: string;
  diasConsecutivos: number;
}

export const INTERJORNADA_MINIMA_HORAS = 11;
// Limite constitucional da jornada semanal (CF, art. 7º, XIII)
export const CARGA_SEMANAL_MAXIMA_HORAS = 44;
export const LIMITE_DIAS_CONSECUTIVOS_TRABALHO = 6; // violacao no 7o dia

const HOUR_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isValidDate = (value: string): boolean => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const isValidHour = (value?: string): value is string => Boolean(value && HOUR_PATTERN.test(value));

const parseDate = (value: string): Date | null => {
  if (!isValidDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const combineDateAndHour = (date: string, hour: string): Date | null => {
  const baseDate = parseDate(date);
  if (!baseDate || !isValidHour(hour)) return null;

  return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, horarioParaMinutos(hour), 0, 0);
};

const roundHour = (value: number) => Math.round(value * 10) / 10;

const toDayNumber = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;

const formatDateBR = (value: string) => {
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

const formatTurno = (dia: DiaEscala, fallback: { inicio: string; fim: string }) => (
  dia.turno && dia.turno.includes('-') ? dia.turno : `${fallback.inicio}-${fallback.fim}`
);

const getShiftHours = (dia: DiaEscala): { inicio: string; fim: string } | null => {
  if (dia.tipo !== 'trabalho') return null;

  if (isValidHour(dia.horaInicio) && isValidHour(dia.horaFim)) {
    return { inicio: dia.horaInicio, fim: dia.horaFim };
  }

  if (typeof dia.turno === 'string' && dia.turno.includes('-')) {
    const [inicio, fim] = dia.turno.split('-').map((value) => value.trim());
    if (isValidHour(inicio) && isValidHour(fim)) {
      return { inicio, fim };
    }
  }

  return null;
};

const getShiftDateRange = (dia: DiaEscala): { inicio: Date; fim: Date; turnoLabel: string } | null => {
  const shiftHours = getShiftHours(dia);
  if (!shiftHours) return null;

  const start = combineDateAndHour(dia.data, shiftHours.inicio);
  const end = combineDateAndHour(dia.data, shiftHours.fim);
  if (!start || !end) return null;

  const adjustedEnd = new Date(end);
  if (adjustedEnd.getTime() <= start.getTime()) {
    adjustedEnd.setDate(adjustedEnd.getDate() + 1);
  }

  return {
    inicio: start,
    fim: adjustedEnd,
    turnoLabel: formatTurno(dia, shiftHours),
  };
};

/**
 * Função pura para calcular a diferença entre fim do turno anterior
 * e início do turno atual.
 */
export function calcularDiferencaInterjornada(
  fimTurnoAnterior: Date,
  inicioTurnoAtual: Date,
): { conforme: boolean; horasDescanso: number } {
  const horasExatas = (inicioTurnoAtual.getTime() - fimTurnoAnterior.getTime()) / 3_600_000;

  // Compara o valor exato: arredondar antes deixaria 10h58 passar como 11h
  return {
    conforme: horasExatas >= INTERJORNADA_MINIMA_HORAS,
    horasDescanso: roundHour(horasExatas),
  };
}

/**
 * Analisa interjornada na malha de escala e retorna violações (< 11h).
 */
export function analisarInterjornadaEscala(diasEscala: DiaEscala[]): {
  conforme: boolean;
  menorInterjornada: number;
  violacoes: ViolacaoInterjornada[];
  alertas: string[];
} {
  const ordered = [...diasEscala]
    .filter((dia) => dia.tipo === 'trabalho')
    .sort((a, b) => a.data.localeCompare(b.data));

  const pairs: Array<{ descansoHoras: number; violacao?: ViolacaoInterjornada }> = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const anterior = ordered[index - 1];
    const atual = ordered[index];

    const anteriorRange = getShiftDateRange(anterior);
    const atualRange = getShiftDateRange(atual);
    if (!anteriorRange || !atualRange) continue;

    const resultado = calcularDiferencaInterjornada(anteriorRange.fim, atualRange.inicio);

    const possibleViolation: ViolacaoInterjornada | undefined = resultado.conforme
      ? undefined
      : {
          dataTurnoAnterior: anterior.data,
          dataTurnoAtual: atual.data,
          descansoHoras: resultado.horasDescanso,
          turnoAnterior: anteriorRange.turnoLabel,
          turnoAtual: atualRange.turnoLabel,
        };

    pairs.push({
      descansoHoras: resultado.horasDescanso,
      violacao: possibleViolation,
    });
  }

  const violacoes = pairs
    .map((pair) => pair.violacao)
    .filter((pair): pair is ViolacaoInterjornada => Boolean(pair));

  const menorInterjornada = pairs.length > 0
    ? Math.min(...pairs.map((pair) => pair.descansoHoras))
    : 24;

  const alertas = violacoes.map((violacao) => (
    `❌ Interjornada abaixo do mínimo em ${formatDateBR(violacao.dataTurnoAtual)}: ${violacao.descansoHoras}h (${violacao.turnoAnterior} → ${violacao.turnoAtual}).`
  ));

  return {
    conforme: violacoes.length === 0,
    menorInterjornada,
    violacoes,
    alertas,
  };
}

/**
 * Função pura para rastrear 7 dias consecutivos de trabalho sem folga (DSR).
 */
export function analisarSetimoDiaConsecutivo(diasEscala: DiaEscala[]): {
  conforme: boolean;
  sequenciaAtual: number;
  maiorSequencia: number;
  violacoes: ViolacaoSetimoDia[];
  ultimaFolga: string | null;
  alertas: string[];
} {
  // Uma entrada por data; se houver duplicidade, prevalece "trabalho" (não pode esconder dias trabalhados)
  const porData = new Map<string, DiaEscala>();
  for (const dia of diasEscala) {
    const existente = porData.get(dia.data);
    if (!existente || dia.tipo === 'trabalho') porData.set(dia.data, dia);
  }
  const ordered = [...porData.values()].sort((a, b) => a.data.localeCompare(b.data));

  let sequenciaAtual = 0;
  let maiorSequencia = 0;
  let previousDate: Date | null = null;
  let previousWasWork = false;

  const violacoes: ViolacaoSetimoDia[] = [];

  for (const dia of ordered) {
    const currentDate = parseDate(dia.data);
    if (!currentDate) continue;

    const isWorkDay = dia.tipo === 'trabalho';
    const hasGap = previousDate ? toDayNumber(currentDate) - toDayNumber(previousDate) !== 1 : false;

    if (isWorkDay) {
      const continuaSequencia = previousWasWork && !hasGap;
      sequenciaAtual = continuaSequencia ? sequenciaAtual + 1 : 1;
      maiorSequencia = Math.max(maiorSequencia, sequenciaAtual);

      if (sequenciaAtual >= 7) {
        violacoes.push({
          data: dia.data,
          diasConsecutivos: sequenciaAtual,
        });
      }
    } else {
      sequenciaAtual = 0;
    }

    previousDate = currentDate;
    previousWasWork = isWorkDay;
  }

  const ultimaFolga = [...ordered]
    .reverse()
    .find((dia) => dia.tipo !== 'trabalho')?.data || null;

  const alertas: string[] = [];

  if (violacoes.length > 0) {
    const firstViolation = violacoes[0];
    alertas.push(
      `❌ DSR violado: sequência de ${firstViolation.diasConsecutivos} dias consecutivos de trabalho (primeira ocorrência em ${formatDateBR(firstViolation.data)}).`,
    );
  } else if (sequenciaAtual === LIMITE_DIAS_CONSECUTIVOS_TRABALHO) {
    alertas.push('⚠️ DSR no limite: colaborador com 6 dias consecutivos de trabalho.');
  }

  return {
    conforme: violacoes.length === 0,
    sequenciaAtual,
    maiorSequencia,
    violacoes,
    ultimaFolga,
    alertas,
  };
}

// Horas de um dia de trabalho (turno que vira a meia-noite conta até o fim no dia seguinte)
const horasDoDia = (dia: DiaEscala): number => {
  if (dia.tipo !== 'trabalho' || !dia.horaInicio || !dia.horaFim) return 0;
  const minutos = horarioParaMinutos(dia.horaFim) - horarioParaMinutos(dia.horaInicio);
  return Number.isNaN(minutos) ? 0 : (minutos < 0 ? minutos + 24 * 60 : minutos) / 60;
};

/**
 * Semana (segunda a domingo) com mais horas na malha. A CLT limita cada semana a 44h: uma semana de 60h não pode
 * sumir na média do mês.
 */
export function calcularMaiorCargaSemanal(diasEscala: DiaEscala[]): { horas: number; inicioSemana: string | null } {
  const porSemana = new Map<string, number>();
  for (const dia of diasEscala) {
    const data = new Date(`${dia.data}T12:00:00Z`);
    const recuo = (data.getUTCDay() + 6) % 7; // dias desde a segunda-feira
    data.setUTCDate(data.getUTCDate() - recuo);
    const semana = data.toISOString().slice(0, 10);
    porSemana.set(semana, (porSemana.get(semana) ?? 0) + horasDoDia(dia));
  }
  let maior = { horas: 0, inicioSemana: null as string | null };
  for (const [semana, horas] of porSemana) if (horas > maior.horas) maior = { horas, inicioSemana: semana };
  return { horas: Math.round(maior.horas * 10) / 10, inicioSemana: maior.inicioSemana };
}

/**
 * Análise completa de conformidade CLT baseada na malha de escala.
 */
/**
 * Média semanal do período. Usada na 12x36 (CLT art. 59-A): o regime alterna semanas de 36h e 48h e é legal desde que a
 * média fique dentro do limite; cobrar 44h semana a semana marcaria toda 12x36 como irregular.
 */
export function calcularCargaSemanalMedia(diasEscala: DiaEscala[]): number {
  if (diasEscala.length === 0) return 0;
  const total = diasEscala.reduce((soma, dia) => soma + horasDoDia(dia), 0);
  return Math.round((total / (diasEscala.length / 7)) * 10) / 10;
}

export function analisarConformidadeCLT(diasEscala: DiaEscala[], opcoes: { tipoEscala?: string } = {}): AnaliseConformidadeCLT {
  const interjornada = analisarInterjornadaEscala(diasEscala);
  const setimoDia = analisarSetimoDiaConsecutivo(diasEscala);

  const regime12x36 = opcoes.tipoEscala === '12x36';
  const maiorSemana = calcularMaiorCargaSemanal(diasEscala);
  const cargaTotal = regime12x36 ? calcularCargaSemanalMedia(diasEscala) : maiorSemana.horas;
  const semanaAnalisada = regime12x36
    ? 'média do período (12x36)'
    : maiorSemana.inicioSemana ? `semana de ${maiorSemana.inicioSemana.split('-').reverse().join('/')}` : 'N/A';

  const cargaConforme = cargaTotal <= CARGA_SEMANAL_MAXIMA_HORAS;
  const alertasCarga = cargaConforme
    ? []
    : [regime12x36
      ? `⚠️ Média de ${cargaTotal}h semanais na 12x36 excede o limite legal de ${CARGA_SEMANAL_MAXIMA_HORAS}h.`
      : `⚠️ Carga de ${cargaTotal}h na ${semanaAnalisada} excede o limite legal de ${CARGA_SEMANAL_MAXIMA_HORAS}h semanais.`];

  const resumo = [
    ...interjornada.alertas,
    ...setimoDia.alertas,
    ...alertasCarga,
  ];

  if (resumo.length === 0) {
    resumo.push('✅ Escala em conformidade com as regras de interjornada, DSR e carga semanal.');
  }

  return {
    interjornada: {
      conforme: interjornada.conforme,
      menorInterjornada: interjornada.menorInterjornada,
      alertas: interjornada.alertas,
    },
    cargaSemanal: {
      conforme: cargaConforme,
      cargaTotal,
      semanaAnalisada,
      alertas: alertasCarga,
    },
    descansoRemunerado: {
      conforme: setimoDia.conforme,
      ultimaFolga: setimoDia.ultimaFolga || 'Não registrada',
      diasSemFolga: setimoDia.sequenciaAtual,
      alertas: setimoDia.alertas,
    },
    statusGeral: interjornada.conforme && setimoDia.conforme && cargaConforme,
    resumo,
  };
}
