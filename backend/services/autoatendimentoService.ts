import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../lib/http';
import { transacaoSerializavel, travarChave } from '../lib/transacao';
import { redisService } from './redisService';
import { config as ambiente } from '../env';
import {
  blocosDoIntervalo,
  chaveTravaProfissional,
  chaveTravaSala,
  validarDisponibilidadeProfissional,
  verificarConflitoSala,
} from './agendaService';
import { DURACAO_PADRAO_MIN, duracaoTotal, instanteNoFuso } from '../../shared/agenda';
import {
  LIMITE_OBSERVACAO,
  MENSAGEM_CPF_INVALIDO,
  MENSAGEM_TELEFONE_INVALIDO,
  apenasDigitos,
  cpfValido,
  normalizarNome,
  normalizarTelefone,
  telefoneValido,
  variantesTelefone,
} from '../../shared/validadores';

// Regras de negócio do totem (reserva, confirmação e configuração), separadas das rotas HTTP

import { PAPEIS_ATENDIMENTO } from '../lib/usuarios';

export { PAPEIS_ATENDIMENTO };
// Prazo para o gateway confirmar um pagamento online antes de o horário voltar para a grade
export const PRAZO_PAGAMENTO_MINUTOS = 30;

type ServicoResumo = { id: string; duracao: number | null; tempoHigienizacaoMin: number | null; preco: number };

// Lê os IDs de serviço da query/corpo (lista, texto separado por vírgula ou ID único)
export const lerIdsServicos = (servicoIds: unknown, servicoId: unknown): string[] => {
  const lista = Array.isArray(servicoIds)
    ? servicoIds
    : typeof servicoIds === 'string' ? servicoIds.split(',') : typeof servicoId === 'string' ? [servicoId] : [];
  return Array.from(new Set(lista.map((id) => String(id).trim()).filter(Boolean))).slice(0, 10);
};

// Duração do atendimento em si, sem a higienização
export const duracaoProduto = (s: { duracao: number | null }) => s.duracao || DURACAO_PADRAO_MIN;

export const resumoServicos = (servicos: ServicoResumo[]) => {
  const duracaoTotalSlot = duracaoTotal(servicos);
  const duracaoTotalProdutos = servicos.reduce((soma, s) => soma + duracaoProduto(s), 0);
  return {
    duracaoTotalProdutos,
    bufferHigienizacao: duracaoTotalSlot - duracaoTotalProdutos,
    duracaoTotalSlot,
    valorTotal: servicos.reduce((soma, s) => soma + s.preco, 0),
  };
};

export type ClienteTotem = { nome: string; telefone: string; cpf: string | null; observacoesSaude: string };

// Valida os dados do cliente digitados no totem
export const lerClienteTotem = (entrada: unknown): ClienteTotem => {
  const cliente = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const nome = typeof cliente.nome === 'string' ? cliente.nome.replace(/\s+/g, ' ').trim() : '';
  const telefone = normalizarTelefone(cliente.telefone);
  const cpf = cliente.cpf ? apenasDigitos(cliente.cpf) : '';
  const observacoesSaude = typeof cliente.observacoesSaude === 'string' ? cliente.observacoesSaude.trim() : '';

  if (nome.length < 3 || nome.length > 120) throw new HttpError(400, 'Informe seu nome completo (3 a 120 caracteres).');
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(nome)) throw new HttpError(400, 'O nome deve conter apenas letras.');
  if (!telefoneValido(telefone)) throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
  if (cpf && !cpfValido(cpf)) throw new HttpError(400, `${MENSAGEM_CPF_INVALIDO} Ou deixe o campo em branco.`);
  if (observacoesSaude.length > LIMITE_OBSERVACAO) throw new HttpError(400, `As observações de saúde devem ter no máximo ${LIMITE_OBSERVACAO} caracteres.`);
  return { nome, telefone, cpf: cpf || null, observacoesSaude };
};

export const validarConfigAutoatendimento = (entrada: unknown) => {
  const body = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const dados: Record<string, unknown> = {};
  const inteiro = (campo: string, min: number, max: number) => {
    if (body[campo] === undefined) return;
    const valor = Number(body[campo]);
    if (!Number.isInteger(valor) || valor < min || valor > max) throw new HttpError(400, `O campo ${campo} deve ser um número inteiro entre ${min} e ${max}.`);
    dados[campo] = valor;
  };
  for (const campo of ['ativo', 'exigirPagamento', 'permitirCancelamento']) {
    if (body[campo] === undefined) continue;
    if (typeof body[campo] !== 'boolean') throw new HttpError(400, `O campo ${campo} deve ser verdadeiro ou falso.`);
    dados[campo] = body[campo];
  }
  if (body.percentualSinal !== undefined) {
    const valor = Number(body.percentualSinal);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) throw new HttpError(400, 'O percentual do sinal deve estar entre 0 e 100.');
    dados.percentualSinal = valor;
  }
  // Reserva temporária curta: cada uma trava profissional e sala, então um teto alto facilita travar a agenda
  inteiro('tempoLockMinutos', 2, 20);
  inteiro('tempoMinimoCancelamentoHoras', 0, 168);
  for (const campo of ['instrucoesCheckin', 'mensagemBoasVindas']) {
    const valor = body[campo];
    if (valor === undefined) continue;
    if (typeof valor !== 'string' || valor.length > 500) throw new HttpError(400, `O campo ${campo} deve ter no máximo 500 caracteres.`);
    dados[campo] = valor.trim();
  }
  return dados;
};

/**
 * Primeiro profissional e primeira sala livres no horário. O profissional/sala sugeridos pelo front
 * passam pelas mesmas checagens dos demais.
 */
export const escolherProfissionalESala = async (
  inicio: Date,
  servicos: Parameters<typeof validarDisponibilidadeProfissional>[3],
  duracaoMin: number,
  preferencia: { terapeutaId?: unknown; salaId?: unknown },
) => {
  const terapeutaId = typeof preferencia.terapeutaId === 'string' && preferencia.terapeutaId ? preferencia.terapeutaId : undefined;
  const salaId = typeof preferencia.salaId === 'string' && preferencia.salaId ? preferencia.salaId : undefined;

  const candidatos = await prisma.colaborador.findMany({
    where: { ativo: true, papel: { in: PAPEIS_ATENDIMENTO }, ...(terapeutaId ? { id: terapeutaId } : {}) },
    orderBy: { nome: 'asc' },
  });
  let terapeuta: (typeof candidatos)[number] | undefined;
  for (const colab of candidatos) {
    if (!(await validarDisponibilidadeProfissional(prisma, colab.id, inicio, servicos))) {
      terapeuta = colab;
      break;
    }
  }
  if (!terapeuta) return { erro: 'Este horário acabou de ficar indisponível. Por favor, escolha outro.' } as const;

  const salas = await prisma.sala.findMany({ where: { ativa: true, ...(salaId ? { id: salaId } : {}) }, orderBy: { numero: 'asc' } });
  let sala: (typeof salas)[number] | undefined;
  for (const s of salas) {
    if (!(await verificarConflitoSala(prisma, s.id, inicio, duracaoMin))) {
      sala = s;
      break;
    }
  }
  if (!sala) return { erro: 'Todas as salas estão ocupadas neste horário. Por favor, escolha outro.' } as const;
  return { terapeuta, sala };
};

/**
 * Trava atômica de todos os blocos de 30 min ocupados (profissional + sala); desfaz tudo se algum falhar.
 * Retorna as chaves travadas, ou null se outro cliente pegou o horário.
 */
export const travarHorario = async (
  data: string, inicioMin: number, duracaoMin: number, terapeutaId: string, salaId: string, sessionToken: string, ttlSegundos: number,
) => {
  const blocos = blocosDoIntervalo(inicioMin, inicioMin + duracaoMin);
  const lockKeys = blocos.flatMap((t) => [chaveTravaProfissional(data, t, terapeutaId), chaveTravaSala(data, t, salaId)]);
  const adquiridas: string[] = [];
  for (const chave of lockKeys) {
    if (!(await redisService.acquireLock(chave, ttlSegundos, sessionToken))) {
      for (const k of adquiridas) await redisService.releaseLock(k, sessionToken);
      return null;
    }
    adquiridas.push(chave);
  }
  return lockKeys;
};

export const liberarReserva = async (sessionToken: string, sessao: { lockKeys?: string[] }) => {
  for (const chave of sessao.lockKeys ?? []) await redisService.releaseLock(chave, sessionToken);
  await redisService.deleteKey(`reserva:${sessionToken}`);
};

// Como a reserva será paga: online (aguarda o gateway), no local, ou sem custo (nada a cobrar)
export const calcularCobranca = (
  sessao: { exigirPagamento?: boolean; valorTotal: number; valorSinal: number },
  tipoPagamento: 'sinal' | 'integral',
) => {
  const valorOnline = tipoPagamento === 'integral' ? sessao.valorTotal : sessao.valorSinal;
  const comPagamentoOnline = sessao.exigirPagamento !== false && valorOnline > 0;
  if (comPagamentoOnline) {
    return { comPagamentoOnline, valorACobrar: valorOnline, statusPagamento: 'aguardando_pagamento', rotuloVoucher: 'aguardando_pagamento' } as const;
  }
  return sessao.valorTotal > 0
    ? { comPagamentoOnline, valorACobrar: 0, statusPagamento: 'pendente_no_local', rotuloVoucher: 'A Pagar na Recepção' } as const
    : { comPagamentoOnline, valorACobrar: 0, statusPagamento: 'sem_custo', rotuloVoucher: 'Sem custo' } as const;
};

export type Cobranca = ReturnType<typeof calcularCobranca>;

// Reserva temporária do totem guardada no Redis entre a escolha do horário e a confirmação
export type SessaoReservaTotem = {
  sessionToken: string;
  servicoIds: string[];
  servicosNomes: string[];
  servicoNome: string;
  servicoId: string;
  data: string;
  horario: string;
  terapeutaId: string;
  salaId: string;
  terapeutaNome: string;
  salaNome: string;
  duracao: number;
  bufferHigienizacao: number;
  duracaoTotalSlot: number;
  valorTotal: number;
  valorSinal: number;
  exigirPagamento: boolean;
  percentualSinal: number;
  instrucoesCheckin: string | null;
  tempoLockMinutos: number;
  lockKeys: string[];
  lockExpiresAt: number;
};

type SessaoReserva = Pick<SessaoReservaTotem, 'servicoIds' | 'data' | 'horario' | 'terapeutaId' | 'salaId' | 'valorTotal'>;

/**
 * Cria o agendamento de uma reserva do totem, revalidando o horário no banco (a recepção pode ter usado
 * o horário enquanto o cliente preenchia os dados).
 *
 * Cadastro existente só é reaproveitado quando nome, telefone E CPF conferem: nome e telefone sozinhos
 * são fáceis de conhecer, e quem está no totem não provou ser o dono do cadastro. Sem CPF, a reserva
 * cria um cadastro novo, que a recepção pode unificar depois. A anamnese digitada no totem fica só no
 * agendamento e nunca é anexada a uma ficha existente.
 */
export const criarAgendamentoTotem = async (
  sessao: SessaoReserva,
  cliente: ClienteTotem,
  opcoes: { sessionToken: string; cobranca: Cobranca; metodoPagamento: string },
) => {
  const servicos = await prisma.servico.findMany({ where: { id: { in: sessao.servicoIds } } });
  const inicio = instanteNoFuso(sessao.data, sessao.horario);
  const observacao = cliente.observacoesSaude ? `[Anamnese Autoatendimento ${sessao.data}]: ${cliente.observacoesSaude}` : null;

  return transacaoSerializavel(async (tx) => {
    await travarChave(tx, `agenda:${sessao.terapeutaId}:${sessao.data}`);

    const indisponivel = await validarDisponibilidadeProfissional(tx, sessao.terapeutaId, inicio, servicos, { sessaoPropria: opcoes.sessionToken });
    if (indisponivel) throw new HttpError(409, 'Este horário acabou de ser ocupado. Por favor, escolha outro horário.');
    if (await verificarConflitoSala(tx, sessao.salaId, inicio, duracaoTotal(servicos), opcoes.sessionToken)) {
      throw new HttpError(409, 'A sala deste horário acabou de ser ocupada. Por favor, escolha outro horário.');
    }

    const reservasAtivas = await tx.agendamento.count({
      where: {
        reservaOrigem: 'autoatendimento',
        status: 'scheduled',
        data: { gte: new Date() },
        cliente: { telefone: { in: variantesTelefone(cliente.telefone) } },
      },
    });
    if (reservasAtivas >= ambiente.totemMaxReservasPorTelefone) {
      throw new HttpError(429, `Este telefone já tem ${reservasAtivas} reserva(s) futura(s) pelo totem. Para marcar mais, fale com a recepção.`);
    }

    const existente = cliente.cpf
      ? (await tx.cliente.findMany({ where: { telefone: { in: variantesTelefone(cliente.telefone) } } }))
        .find((c) => normalizarNome(c.nome) === normalizarNome(cliente.nome) && c.cpf && apenasDigitos(c.cpf) === cliente.cpf)
      : undefined;
    const dbCliente = existente
      ?? await tx.cliente.create({ data: { nome: cliente.nome, telefone: cliente.telefone, cpf: cliente.cpf, observacao } });

    return tx.agendamento.create({
      data: {
        data: inicio,
        status: 'scheduled',
        colaboradorId: sessao.terapeutaId,
        clienteId: dbCliente.id,
        salaId: sessao.salaId,
        valorTotal: sessao.valorTotal,
        valorSinal: opcoes.cobranca.valorACobrar,
        statusPagamento: opcoes.cobranca.statusPagamento,
        // Sem confirmação do gateway até este prazo, a limpeza automática cancela e libera o horário
        lockExpiresAt: opcoes.cobranca.comPagamentoOnline ? new Date(Date.now() + PRAZO_PAGAMENTO_MINUTOS * 60_000) : null,
        metodoPagamento: opcoes.cobranca.comPagamentoOnline ? opcoes.metodoPagamento : 'presencial_no_local',
        reservaToken: opcoes.sessionToken,
        reservaOrigem: 'autoatendimento',
        observacoesSaude: cliente.observacoesSaude || null,
        servicos: { connect: servicos.map((s) => ({ id: s.id })) },
      } satisfies Prisma.AgendamentoUncheckedCreateInput,
    });
  });
};
