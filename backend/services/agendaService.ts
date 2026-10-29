import { PAPEIS_ATENDIMENTO } from '../lib/usuarios';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { redisService } from './redisService';
import {
  duracaoTotal,
  intervalosSobrepoem,
  INTERVALO_SLOT_TOTEM_MIN,
  minutosParaHorario,
  partesNoFuso,
  horarioParaMinutos,
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

type ServicoElegibilidade = {
  nome: string;
  modoElegibilidade?: string | null;
  cargosPermitidos?: string[] | null;
  habilidadesPermitidas?: string[] | null;
  profissionaisPermitidos?: string[] | null;
};

type ColaboradorElegibilidade = { id: string; nome?: string | null; cargo?: string | null; especialidade?: string | null; habilidades?: string[] | null };

export const erroElegibilidade = (colaborador: ColaboradorElegibilidade, servicos: ServicoElegibilidade[]): string | null => {
  const cargo = normalizarNome(colaborador.cargo || colaborador.especialidade || '');
  const habilidades = new Set((colaborador.habilidades || []).map(normalizarNome));

  for (const servico of servicos) {
    const modo = normalizarModoElegibilidade(servico.modoElegibilidade);
    if (modo === 'cargo') {
      const cargos = (servico.cargosPermitidos || []).map(normalizarNome).filter(Boolean);
      if (cargos.length === 0 || !cargo || !cargos.includes(cargo)) {
        return `Profissional não habilitado para o serviço ${servico.nome} (restrição por cargo).`;
      }
    }
    if (modo === 'habilidade') {
      const permitidas = (servico.habilidadesPermitidas || []).map(normalizarNome);
      if (permitidas.length === 0 || !permitidas.some((h) => habilidades.has(h))) {
        return `Profissional não habilitado para o serviço ${servico.nome} (restrição por habilidade).`;
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

export const getErroElegibilidade = async (db: DbOuTransacao, colaboradorId: string, servicos: ServicoElegibilidade[]) => {
  const colaborador = await db.colaborador.findUnique({
    where: { id: colaboradorId },
    select: { id: true, nome: true, cargo: true, especialidade: true, habilidades: true, ativo: true, papel: true },
  });
  if (!colaborador || !colaborador.ativo) return 'Profissional não encontrado.';
  // Recepção, supervisão e admin não atendem: agendar para eles daria acesso indevido à ficha de saúde
  if (!PAPEIS_ATENDIMENTO.includes(colaborador.papel)) return 'Só é possível agendar para profissionais que atendem clientes.';
  return erroElegibilidade(colaborador, servicos);
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

const formatarDataHora = (instante: Date) => {
  const { data, horario } = partesNoFuso(instante);
  return `${data.slice(8, 10)}/${data.slice(5, 7)} ${horario}`;
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
  const diaInicio = partesNoFuso(inicio).data;
  const diaFim = partesNoFuso(fim).data;
  const horasEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

  const anterior = await db.agendamento.findFirst({
    where: { ...filtroBase, data: { lt: inicio } },
    include: { servicos: true },
    orderBy: { data: 'desc' },
  });
  if (anterior) {
    const fimAnterior = new Date(anterior.data.getTime() + duracaoTotal(anterior.servicos) * 60_000);
    const descanso = horasEntre(fimAnterior, inicio);
    if (partesNoFuso(fimAnterior).data !== diaInicio && descanso > 0 && descanso < DESCANSO_INTERJORNADA_HORAS) {
      return `Violação CLT (interjornada): o descanso entre o último atendimento (${formatarDataHora(fimAnterior)}) e este (${formatarDataHora(inicio)}) seria de apenas ${descanso.toFixed(1)}h. O mínimo legal é ${DESCANSO_INTERJORNADA_HORAS}h.`;
    }
  }

  const posterior = await db.agendamento.findFirst({
    where: { ...filtroBase, data: { gte: fim } },
    orderBy: { data: 'asc' },
  });
  if (posterior) {
    const descanso = horasEntre(fim, posterior.data);
    if (partesNoFuso(posterior.data).data !== diaFim && descanso > 0 && descanso < DESCANSO_INTERJORNADA_HORAS) {
      return `Violação CLT (interjornada): o descanso entre este atendimento e o próximo (${formatarDataHora(posterior.data)}) seria de apenas ${descanso.toFixed(1)}h. O mínimo legal é ${DESCANSO_INTERJORNADA_HORAS}h.`;
    }
  }
  return null;
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
  opcoes: { ignorarAgendamentoId?: string; sessaoPropria?: string } = {},
): Promise<{ status: number; erro: string } | null> => {
  const { data } = partesNoFuso(inicio);
  const msgEscala = mensagemIndisponibilidadeEscala(await getEscalaDoDia(db, colaboradorId, data));
  if (msgEscala) return { status: 409, erro: msgEscala };

  const erroElegivel = await getErroElegibilidade(db, colaboradorId, servicos);
  if (erroElegivel) return { status: 409, erro: erroElegivel };

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
