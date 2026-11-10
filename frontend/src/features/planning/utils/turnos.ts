import { TURNO_REGEX, horarioParaMinutos } from '@shared/agenda';
import { horaInicialDoTurno, separarTurno, type DiaEscala } from '../../../utils/escalaCalculator';
import {
  CARGA_SEMANAL_MAXIMA_HORAS,
  analisarConformidadeCLT,
  analisarInterjornadaEscala,
  analisarSetimoDiaConsecutivo,
  horasDoDia,
} from '../../../utils/cltValidator';

// Regras de exibição de turno da Grade de Escalas, num lugar só (calendário, linha do tempo, painel e modal do dia)

export type CategoriaTurno = 'manha' | 'comercial' | 'tarde' | 'noite';
export type CategoriaDia = CategoriaTurno | 'folga' | 'fds' | 'feriado';

/**
 * Turno "HH:MM-HH:MM" do dia de trabalho; undefined quando o dia não tem turno (o normal na malha do contrato: a agenda
 * aceita qualquer horário da casa) ou tem um texto ilegível. Nunca vira 08:00 escondido.
 */
export const turnoDoDia = (dia?: DiaEscala | null): string | undefined => {
  if (!dia || dia.tipo !== 'trabalho') return undefined;
  if (dia.horaInicio && dia.horaFim) {
    const turno = `${dia.horaInicio}-${dia.horaFim}`;
    if (TURNO_REGEX.test(turno)) return turno;
  }
  return dia.turno && TURNO_REGEX.test(dia.turno) ? dia.turno : undefined;
};

/** Período do turno pela hora de início; "comercial" é o turno da manhã que vai até o fim da tarde (17h ou depois) */
export const categoriaDoTurno = (turno?: string | null): CategoriaTurno | null => {
  const inicio = horaInicialDoTurno(turno);
  if (inicio === null) return null;
  if (inicio >= 18 || inicio < 5) return 'noite';
  if (inicio >= 12) return 'tarde';
  const { horaFim } = separarTurno(turno);
  return horaFim && horarioParaMinutos(horaFim) >= 17 * 60 ? 'comercial' : 'manha';
};

// Dia de trabalho sem turno conta como comercial (o horário da casa), como sempre foi no filtro da grade
export const categoriaDoDia = (dia?: DiaEscala | null): CategoriaDia | null => {
  if (!dia) return null;
  if (dia.tipo !== 'trabalho') return dia.feriadoNome ? 'feriado' : dia.tipo;
  return categoriaDoTurno(turnoDoDia(dia)) ?? 'comercial';
};

type VisualCategoria = { rotulo: string; icone: string; cor: string; barra: string; fundo: string; texto: string };

// Classes completas (o Tailwind só gera o que aparece literal no código)
export const VISUAL_CATEGORIA: Record<CategoriaDia, VisualCategoria> = {
  comercial: { rotulo: 'Comercial', icone: 'work', cor: 'bg-emerald-500', barra: 'border-l-emerald-500', fundo: 'bg-emerald-500/15', texto: 'text-emerald-700 dark:text-emerald-300' },
  manha: { rotulo: 'Manhã', icone: 'light_mode', cor: 'bg-sky-500', barra: 'border-l-sky-500', fundo: 'bg-sky-500/15', texto: 'text-sky-700 dark:text-sky-300' },
  tarde: { rotulo: 'Tarde', icone: 'partly_cloudy_day', cor: 'bg-amber-500', barra: 'border-l-amber-500', fundo: 'bg-amber-500/15', texto: 'text-amber-700 dark:text-amber-300' },
  noite: { rotulo: 'Noite', icone: 'dark_mode', cor: 'bg-violet-500', barra: 'border-l-violet-500', fundo: 'bg-violet-500/15', texto: 'text-violet-700 dark:text-violet-300' },
  folga: { rotulo: 'Folga', icone: 'event_busy', cor: 'bg-outline', barra: 'border-l-outline/60', fundo: 'bg-surface-container-low', texto: 'text-on-surface-variant' },
  fds: { rotulo: 'FDS', icone: 'weekend', cor: 'bg-outline', barra: 'border-l-outline/60', fundo: 'bg-surface-container-low', texto: 'text-on-surface-variant' },
  feriado: { rotulo: 'Feriado', icone: 'celebration', cor: 'bg-rose-500', barra: 'border-l-rose-500', fundo: 'bg-rose-500/10', texto: 'text-rose-700 dark:text-rose-300' },
};

export const visualDoDia = (dia?: DiaEscala | null) => VISUAL_CATEGORIA[categoriaDoDia(dia) ?? 'folga'];

export const LEGENDA_CATEGORIAS: CategoriaDia[] = ['comercial', 'manha', 'tarde', 'noite', 'folga', 'feriado'];

export const iniciais = (nome?: string | null) =>
  (nome || '').split(' ').filter(Boolean).slice(0, 2).map((parte) => parte[0]?.toUpperCase()).join('') || '?';

export const formatarHoras = (horas: number) => `${String(Math.round(horas * 10) / 10).replace('.', ',')}h`;

const deslocarData = (data: string, dias: number) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/**
 * Regras da CLT para um mês (prefixo "AAAA-MM-"), pelas funções compartilhadas com o backend. A escala pode trazer os
 * meses vizinhos: interjornada e 7º dia na virada contam, e a semana que cruza o mês entra inteira. Calendário e
 * painel lateral usam esta mesma conta, para nunca darem vereditos diferentes lado a lado.
 */
export function analisarMes(escala: DiaEscala[], prefixoMes: string, tipoEscala?: string) {
  const doMes = escala.filter((dia) => dia.data.startsWith(prefixoMes));
  const datas = doMes.map((dia) => dia.data).sort();
  const primeiro = datas[0] ?? `${prefixoMes}01`;
  const ultimo = datas[datas.length - 1] ?? primeiro;
  const inicioSemanas = deslocarData(primeiro, -((new Date(`${primeiro}T12:00:00Z`).getUTCDay() + 6) % 7));
  const fimSemanas = deslocarData(ultimo, (7 - new Date(`${ultimo}T12:00:00Z`).getUTCDay()) % 7);
  const carga = analisarConformidadeCLT(
    escala.filter((dia) => dia.data >= inicioSemanas && dia.data <= fimSemanas),
    { tipoEscala },
  ).cargaSemanal;
  const interjornada = analisarInterjornadaEscala(escala).violacoes.filter((v) => v.dataTurnoAtual.startsWith(prefixoMes));
  const setimoDia = analisarSetimoDiaConsecutivo(escala).violacoes.filter((v) => v.data.startsWith(prefixoMes));
  const alertas = [
    ...interjornada.map((v) => `Descanso de ${formatarHoras(v.descansoHoras)} entre jornadas em ${v.dataTurnoAtual.split('-').reverse().join('/')} (mínimo 11h).`),
    ...(setimoDia.length > 0 ? [`7º dia seguido sem folga em ${setimoDia[0].data.split('-').reverse().join('/')}.`] : []),
    ...(carga.conforme ? [] : [tipoEscala === '12x36'
      ? `Média semanal de ${formatarHoras(carga.cargaTotal)}, acima do limite de ${CARGA_SEMANAL_MAXIMA_HORAS}h.`
      : `Semana de ${formatarHoras(carga.cargaTotal)}, acima do limite de ${CARGA_SEMANAL_MAXIMA_HORAS}h (${carga.semanaAnalisada}).`]),
  ];
  return {
    conforme: alertas.length === 0,
    alertas,
    carga,
    interjornada: new Map(interjornada.map((v) => [Number(v.dataTurnoAtual.slice(8, 10)), v.descansoHoras])),
    setimoDia: new Set(setimoDia.map((v) => Number(v.data.slice(8, 10)))),
    horasMes: doMes.reduce((soma, dia) => soma + horasDoDia(dia), 0),
    diasTrabalhados: doMes.filter((dia) => dia.tipo === 'trabalho').length,
    diasDescanso: doMes.filter((dia) => dia.tipo !== 'trabalho').length,
    // Dia sem turno não tem horas para somar (a análise CLT do backend também não conta)
    diasSemTurno: doMes.filter((dia) => dia.tipo === 'trabalho' && !turnoDoDia(dia)).length,
  };
}
