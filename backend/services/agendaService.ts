import { formatarDataHoraBR } from '../../shared/datasBR';
import { PAPEIS_ATENDIMENTO } from '../lib/usuarios';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { redisService } from './redisService';
import { travarChave } from '../lib/transacao';
import {
  duracaoTotal,
  intervalosSobrepoem,
  INTERVALO_SLOT_TOTEM_MIN,
  minutosParaHorario,
  partesNoFuso,
  horarioParaMinutos,
  TURNO_REGEX,
  type ServicoComDuracao,
} from '../../shared/agenda';
import { normalizarNome } from '../../shared/validadores';

/**
 * Regras de disponibilidade usadas pela agenda interna e pelo totem de autoatendimento.
 * Toda checagem de conflito passa por aqui para os dois módulos não divergirem.
 */

// Cliente do Prisma ou transação aberta: as consultas funcionam com os dois
export type DbOuTransacao = typeof prisma | Prisma.TransactionClient;

export const MODOS_ELEGIBILIDADE = ['livre', 'cargo', 'habilidade', 'profissional'] as const;
export type ModoElegibilidade = (typeof MODOS_ELEGIBILIDADE)[number];

export const normalizarModoElegibilidade = (valor: unknown): ModoElegibilidade =>
  (MODOS_ELEGIBILIDADE as readonly unknown[]).includes(valor) ? (valor as ModoElegibilidade) : 'livre';

export const DESCANSO_INTERJORNADA_HORAS = 11;

// Chave de trava do totem para um bloco de 30 min de um profissional ou sala
export const chaveTravaProfissional = (data: string, minutos: number, colaboradorId: string) =>
  `lock:slot:${data}:${minutosParaHorario(minutos)}:${colaboradorId}`;
export const chaveTravaSala = (data: string, minutos: number, salaId: string) =>
  `lock:sala:${data}:${minutosParaHorario(minutos)}:${salaId}`;

// Blocos de 30 min (alinhados) que cobrem o intervalo [inicio, fim)
export const blocosDoIntervalo = (inicioMin: number, fimMin: number) => {
  const blocos: number[] = [];
  const primeiro = Math.floor(inicioMin / INTERVALO_SLOT_TOTEM_MIN) * INTERVALO_SLOT_TOTEM_MIN;
  for (let t = primeiro; t < fimMin; t += INTERVALO_SLOT_TOTEM_MIN) blocos.push(t);
  return blocos;
};

// Verifica travas temporárias do totem; ignora as da própria sessão (ao confirmar uma reserva)
export const existeTrava = async (chaves: string[], sessaoPropria?: string) => {
  for (const chave of chaves) {
    const dono = await redisService.get(chave);
    if (dono && dono !== sessaoPropria) return true;
  }
  return false;
};

export const getEscalaDoDia = (db: DbOuTransacao, colaboradorId: string, data: string) =>
  db.escalaOverride.findUnique({ where: { key: `${colaboradorId}:${data}` } });

export const mensagemIndisponibilidadeEscala = (escala: { tipo?: string | null; descricao?: string | null } | null) => {
  if (!escala?.tipo || escala.tipo === 'trabalho') return null;
  const rotulo = escala.tipo === 'fds' ? 'FDS' : /f[eé]rias/i.test(escala.descricao || '') ? 'Férias' : 'Folga';
  return `Profissional indisponível na escala: ${rotulo}${escala.descricao ? ` (${escala.descricao})` : ''}.`;
};

// Dia de trabalho com turno definido na escala: o atendimento inteiro precisa caber nele (noturno vira a meia-noite)
export const mensagemForaDoTurno = (
  escala: { tipo?: string | null; turno?: string | null } | null,
  inicioMin: number,
  fimMin: number,
) => {
  if (escala?.tipo !== 'trabalho' || !escala.turno || !TURNO_REGEX.test(escala.turno)) return null;
  const [inicioTurno, fimTurno] = escala.turno.split('-').map(horarioParaMinutos);
  const fimEfetivo = fimTurno <= inicioTurno ? fimTurno + 24 * 60 : fimTurno;
  return inicioMin < inicioTurno || fimMin > fimEfetivo
    ? `O horário fica fora do turno do profissional neste dia (${escala.turno}).`
    : null;
};

type HabilidadeRef = { id: string; ativa?: boolean | null };

type ServicoElegibilidade = {
  id?: string;
  nome: string;
  modoElegibilidade?: string | null;
  cargosPermitidos?: string[] | null;
  profissionaisPermitidos?: string[] | null;
  // Habilidades exigidas pelo serviço (basta ter uma); arquivadas não contam
  habilidadesExigidas?: HabilidadeRef[] | null;
};

type ColaboradorElegibilidade = {
  id: string; nome?: string | null; cargo?: string | null; especialidade?: string | null; habilidadesCadastradas?: HabilidadeRef[] | null;
};

export const EXIGENCIAS_HABILIDADE = ['sempre', 'apenas_totem', 'desligado'] as const;
export type ExigenciaHabilidade = (typeof EXIGENCIAS_HABILIDADE)[number];
export type OrigemAgendamento = 'totem' | 'interno';
export const RESTRICAO_HABILIDADE = '(restrição por habilidade)';

// Chave global da empresa: 'sempre' barra em todo lugar; 'apenas_totem' barra só no totem (a agenda avisa); 'desligado' ignora
export const habilidadeBarra = (exigencia: string | null | undefined, origem: OrigemAgendamento) =>
  exigencia === 'sempre' || (exigencia === 'apenas_totem' && origem === 'totem')
  || !(EXIGENCIAS_HABILIDADE as readonly unknown[]).includes(exigencia);

const ativas = (lista?: HabilidadeRef[] | null) => (lista || []).filter((h) => h.ativa !== false);

export const erroElegibilidade = (
  colaborador: ColaboradorElegibilidade,
  servicos: ServicoElegibilidade[],
  { checarHabilidade = true }: { checarHabilidade?: boolean } = {},
): string | null => {
  const cargo = normalizarNome(colaborador.cargo || colaborador.especialidade || '');
  const habilidades = new Set(ativas(colaborador.habilidadesCadastradas).map((h) => h.id));

  for (const servico of servicos) {
    const modo = normalizarModoElegibilidade(servico.modoElegibilidade);
    if (modo === 'cargo') {
      const cargos = (servico.cargosPermitidos || []).map(normalizarNome).filter(Boolean);
      if (cargos.length === 0 || !cargo || !cargos.includes(cargo)) {
        return `Profissional não habilitado para o serviço ${servico.nome} (restrição por cargo).`;
      }
    }
    if (modo === 'habilidade' && checarHabilidade) {
      // Sem nenhuma habilidade ativa exigida (todas arquivadas), o serviço deixa de restringir
      const exigidas = ativas(servico.habilidadesExigidas);
      if (exigidas.length > 0 && !exigidas.some((h) => habilidades.has(h.id))) {
        return `Profissional não possui a habilidade exigida pelo serviço ${servico.nome} ${RESTRICAO_HABILIDADE}.`;
      }
    }
    if (modo === 'profissional') {
      // Aceita o ID ou o nome do profissional (a tela de serviços grava nomes)
      const permitidos = (servico.profissionaisPermitidos || []).map(normalizarNome);
      if (!permitidos.includes(normalizarNome(colaborador.id)) && !permitidos.includes(normalizarNome(colaborador.nome))) {
        return `O serviço ${servico.nome} é exclusivo de profissionais específicos.`;
      }
    }
  }
  return null;
};

// Habilidades ativas exigidas por cada serviço, lidas do banco (quem chama pode passar o serviço sem o vínculo)
const comHabilidadesExigidas = async <S extends ServicoElegibilidade>(db: DbOuTransacao, servicos: S[]) => {
  const ids = servicos.map((s) => s.id).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return servicos;
  const vinculos = await db.servico.findMany({
    where: { id: { in: ids } },
    select: { id: true, habilidadesExigidas: { where: { ativa: true }, select: { id: true } } },
  });
  const porId = new Map(vinculos.map((v) => [v.id, v.habilidadesExigidas]));
  return servicos.map((s) => (s.id && porId.has(s.id) ? { ...s, habilidadesExigidas: porId.get(s.id) } : s));
};

export const getErroElegibilidade = async (
  db: DbOuTransacao, colaboradorId: string, servicos: ServicoElegibilidade[], { checarHabilidade = true }: { checarHabilidade?: boolean } = {},
) => {
  const colaborador = await db.colaborador.findUnique({
    where: { id: colaboradorId },
    select: {
      id: true, nome: true, cargo: true, especialidade: true, ativo: true, papel: true,
      habilidadesCadastradas: { where: { ativa: true }, select: { id: true } },
    },
  });
  if (!colaborador || !colaborador.ativo) return 'Profissional não encontrado.';
  // Recepção, supervisão e admin não atendem: agendar para eles daria acesso indevido à ficha de saúde
  if (!PAPEIS_ATENDIMENTO.includes(colaborador.papel)) return 'Só é possível agendar para profissionais que atendem clientes.';
  return erroElegibilidade(colaborador, await comHabilidadesExigidas(db, servicos), { checarHabilidade });
};

const lerExigencia = async (db: DbOuTransacao) =>
  (await db.configuracaoEmpresa.findUnique({ where: { id: 'default' }, select: { exigenciaHabilidades: true } }))?.exigenciaHabilidades ?? 'sempre';

// Agenda interna no modo 'apenas_totem': o agendamento passa, mas a recepção vê que falta a habilidade
export const avisoDeHabilidade = async (db: DbOuTransacao, colaboradorId: string, servicos: ServicoElegibilidade[]) => {
  if ((await lerExigencia(db)) !== 'apenas_totem') return null;
  const erro = await getErroElegibilidade(db, colaboradorId, servicos);
  return erro?.includes(RESTRICAO_HABILIDADE) ? erro.replace(` ${RESTRICAO_HABILIDADE}`, '') + ' Agendado mesmo assim (exigência só no totem).' : null;
};

type AgendamentoComServicos = { id: string; data: Date; servicos: ServicoComDuracao[] };

// Intervalo do agendamento no fuso do negócio
export const intervaloDoAgendamento = (ag: AgendamentoComServicos) => {
  const { data, minutos } = partesNoFuso(ag.data);
  return { data, inicioMin: minutos, fimMin: minutos + duracaoTotal(ag.servicos) };
};

const JANELA_BUSCA_MS = 36 * 60 * 60 * 1000;

// Agendamentos ativos de um dia (no fuso do negócio), opcionalmente filtrados
export const agendamentosDoDia = async (
  db: DbOuTransacao,
  data: string,
  filtro: Prisma.AgendamentoWhereInput = {},
) => {
  const referencia = new Date(`${data}T12:00:00Z`).getTime();
  const lista = await db.agendamento.findMany({
    where: {
      ...filtro,
      status: { notIn: ['cancelled', 'no_show'] },
      data: { gte: new Date(referencia - JANELA_BUSCA_MS), lte: new Date(referencia + JANELA_BUSCA_MS) },
    },
    include: { servicos: true },
  });
  return lista
    .map((ag) => ({ ...ag, ...intervaloDoAgendamento(ag) }))
    .filter((ag) => ag.data === data);
};

/**
 * Conflito de agenda de um profissional: outros agendamentos, bloqueios e travas do totem.
 */
export const verificarConflito = async (
  db: DbOuTransacao,
  colaboradorId: string,
  inicio: Date,
  duracaoMin: number,
  { ignorarAgendamentoId, sessaoPropria }: { ignorarAgendamentoId?: string; sessaoPropria?: string } = {},
): Promise<{ tipo: 'agendamento' | 'bloqueio' | 'reserva'; id?: string } | null> => {
  const { data, minutos: inicioMin } = partesNoFuso(inicio);
  const fimMin = inicioMin + duracaoMin;

  const doDia = await agendamentosDoDia(db, data, { colaboradorId });
  const conflito = doDia.find((ag) => ag.id !== ignorarAgendamentoId
    && intervalosSobrepoem(inicioMin, fimMin, ag.inicioMin, ag.fimMin));
  if (conflito) return { tipo: 'agendamento', id: conflito.id };

  const bloqueios = await db.bloqueio.findMany({ where: { colaboradorId, data } });
  const bloqueio = bloqueios.find((b) =>
    intervalosSobrepoem(inicioMin, fimMin, horarioParaMinutos(b.horaInicio), horarioParaMinutos(b.horaFim)));
  if (bloqueio) return { tipo: 'bloqueio', id: bloqueio.id };

  const chaves = blocosDoIntervalo(inicioMin, fimMin).map((t) => chaveTravaProfissional(data, t, colaboradorId));
  if (await existeTrava(chaves, sessaoPropria)) return { tipo: 'reserva' };

  return null;
};

export const verificarConflitoSala = async (
  db: DbOuTransacao,
  salaId: string,
  inicio: Date,
  duracaoMin: number,
  sessaoPropria?: string,
) => {
  const { data, minutos: inicioMin } = partesNoFuso(inicio);
  const fimMin = inicioMin + duracaoMin;
  const doDia = await agendamentosDoDia(db, data, { salaId });
  if (doDia.some((ag) => intervalosSobrepoem(inicioMin, fimMin, ag.inicioMin, ag.fimMin))) return true;
  const chaves = blocosDoIntervalo(inicioMin, fimMin).map((t) => chaveTravaSala(data, t, salaId));
  return existeTrava(chaves, sessaoPropria);
};

const formatarDataHora = (instante: Date) => formatarDataHoraBR(instante);

export const verificarCLTInterjornadaEmMemoria = (
  agendamentosOrdenados: Array<{ data: Date; servicos: ServicoComDuracao[] }>,
  inicio: Date,
  duracaoMin: number,
): string | null => {
  const fim = new Date(inicio.getTime() + duracaoMin * 60_000);
  const diaInicio = partesNoFuso(inicio).data;
  const diaFim = partesNoFuso(fim).data;
  const horasEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

  let anterior: { data: Date; servicos: ServicoComDuracao[] } | undefined;
  let posterior: { data: Date; servicos: ServicoComDuracao[] } | undefined;
  for (const ag of agendamentosOrdenados) {
    if (ag.data.getTime() < inicio.getTime()) {
      anterior = ag;
    } else if (!posterior && ag.data.getTime() >= fim.getTime()) {
      posterior = ag;
    }
  }

  if (anterior) {
    const fimAnterior = new Date(anterior.data.getTime() + duracaoTotal(anterior.servicos) * 60_000);
    const descanso = horasEntre(fimAnterior, inicio);
    if (partesNoFuso(fimAnterior).data !== diaInicio && descanso > 0 && descanso < DESCANSO_INTERJORNADA_HORAS) {
      return `Violação CLT (interjornada): o descanso entre o último atendimento (${formatarDataHora(fimAnterior)}) e este (${formatarDataHora(inicio)}) seria de apenas ${descanso.toFixed(1)}h. O mínimo legal é ${DESCANSO_INTERJORNADA_HORAS}h.`;
    }
  }

  if (posterior) {
    const descanso = horasEntre(fim, posterior.data);
    if (partesNoFuso(posterior.data).data !== diaFim && descanso > 0 && descanso < DESCANSO_INTERJORNADA_HORAS) {
      return `Violação CLT (interjornada): o descanso entre este atendimento e o próximo (${formatarDataHora(posterior.data)}) seria de apenas ${descanso.toFixed(1)}h. O mínimo legal é ${DESCANSO_INTERJORNADA_HORAS}h.`;
    }
  }
  return null;
};

/**
 * Interjornada (CLT art. 66): 11h de descanso entre o fim de uma jornada e o início da seguinte.
 * Só se aplica entre dias diferentes; vários atendimentos no mesmo dia fazem parte da mesma jornada.
 */
export const verificarCLTInterjornada = async (
  db: DbOuTransacao,
  colaboradorId: string,
  inicio: Date,
  duracaoMin: number,
  ignorarAgendamentoId?: string,
): Promise<string | null> => {
  const filtroBase = {
    colaboradorId,
    status: { notIn: ['cancelled', 'no_show'] },
    ...(ignorarAgendamentoId ? { id: { not: ignorarAgendamentoId } } : {}),
  };
  const fim = new Date(inicio.getTime() + duracaoMin * 60_000);

  const [anterior, posterior] = await Promise.all([
    db.agendamento.findFirst({
      where: { ...filtroBase, data: { lt: inicio } },
      include: { servicos: true },
      orderBy: { data: 'desc' },
    }),
    db.agendamento.findFirst({
      where: { ...filtroBase, data: { gte: fim } },
      include: { servicos: true },
      orderBy: { data: 'asc' },
    }),
  ]);

  const candidatos = [anterior, posterior].filter((ag): ag is NonNullable<typeof ag> => Boolean(ag));
  return verificarCLTInterjornadaEmMemoria(candidatos, inicio, duracaoMin);
};

/**
 * Checagem completa de um profissional para um horário: escala, elegibilidade, conflitos e CLT.
 * Retorna { status, erro } quando indisponível.
 */
export const validarDisponibilidadeProfissional = async (
  db: DbOuTransacao,
  colaboradorId: string,
  inicio: Date,
  servicos: Array<ServicoElegibilidade & ServicoComDuracao>,
  opcoes: { ignorarAgendamentoId?: string; sessaoPropria?: string; origem?: OrigemAgendamento } = {},
): Promise<{ status: number; erro: string } | null> => {
  const { data, minutos } = partesNoFuso(inicio);
  const escala = await getEscalaDoDia(db, colaboradorId, data);
  const msgEscala = mensagemIndisponibilidadeEscala(escala) ?? mensagemForaDoTurno(escala, minutos, minutos + duracaoTotal(servicos));
  if (msgEscala) return { status: 409, erro: msgEscala };

  const checarHabilidade = habilidadeBarra(await lerExigencia(db), opcoes.origem ?? 'interno');
  const erroElegivel = await getErroElegibilidade(db, colaboradorId, servicos, { checarHabilidade });
  // Falta de habilidade é regra de negócio do pedido (422), não disputa de horário (409)
  if (erroElegivel) return { status: erroElegivel.includes(RESTRICAO_HABILIDADE) ? 422 : 409, erro: erroElegivel };

  const duracao = duracaoTotal(servicos);
  const conflito = await verificarConflito(db, colaboradorId, inicio, duracao, opcoes);
  if (conflito) {
    const erro = conflito.tipo === 'reserva'
      ? 'Este horário está reservado temporariamente no autoatendimento. Escolha outro horário.'
      : conflito.tipo === 'bloqueio'
        ? 'O profissional está com a agenda bloqueada neste horário.'
        : 'Conflito de agenda: o horário coincide com outro atendimento.';
    return { status: 409, erro };
  }

  const erroClt = await verificarCLTInterjornada(db, colaboradorId, inicio, duracao, opcoes.ignorarAgendamentoId);
  if (erroClt) return { status: 409, erro: erroClt };

  return null;
};

/**
 * Outro atendimento ativo do mesmo cliente que se sobrepõe a [inicio, inicio + duração): a mesma pessoa não está em
 * dois lugares ao mesmo tempo. Vale na agenda interna (o totem não barra para não revelar se o cliente tem horário).
 * Trava o cliente até o fim da transação: duas marcações dele ao mesmo tempo esperam uma pela outra.
 */
export const atendimentoSobrepostoDoCliente = async (
  tx: Prisma.TransactionClient, clienteId: string, inicio: Date, duracaoMin: number, ignorarId?: string,
) => {
  await travarChave(tx, `cliente:${clienteId}`);
  const fim = inicio.getTime() + duracaoMin * 60_000;
  const candidatos = await tx.agendamento.findMany({
    where: {
      clienteId,
      ...(ignorarId ? { id: { not: ignorarId } } : {}),
      OR: [{ status: 'scheduled' }, { status: null }],
      // Um dia antes já cobre o atendimento mais longo possível que ainda esteja em curso no início deste
      data: { gte: new Date(inicio.getTime() - 24 * 3_600_000), lt: new Date(fim) },
    },
    include: { servicos: true, colaborador: { select: { nome: true } } },
  });
  return candidatos.find((ag) => ag.data.getTime() + duracaoTotal(ag.servicos) * 60_000 > inicio.getTime()) ?? null;
};
