import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, ipDoCliente, responderErro, type Notificar } from '../lib/http';
import { transacaoSerializavel, travarChave } from '../lib/transacao';
import { ORIGEM_COLABORADOR, clientesComAcessoSaude, prepararAgendamento } from '../lib/privacidade';
import { validarDisponibilidadeProfissional } from '../services/agendaService';
import { buscarServicosPorNome } from '../services/servicoService';
import { lerDesde } from '../lib/periodo';
import { LIMITE_HISTORICO_CLIENTE } from '../../shared/agendaJanela';
import {
  HORA_FECHAMENTO,
  HORA_FECHAMENTO_TEXTO,
  dataValida,
  duracaoTotal,
  horarioParaMinutos,
  horarioValido,
  instanteNoFuso,
  partesNoFuso,
  validarHorarioAgendamento,
} from '../../shared/agenda';
import {
  LIMITE_OBSERVACAO,
  MENSAGEM_CPF_INVALIDO,
  MENSAGEM_TELEFONE_INVALIDO,
  apenasDigitos,
  cpfValido,
  normalizarNome,
  normalizarTelefone,
  telefoneValido,
  valorMascarado,
  variantesCpf,
  variantesTelefone,
} from '../../shared/validadores';

export const STATUS_AGENDAMENTO = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
// Do profissional vai só o necessário para exibir (e-mail, carga horária e versão do token ficam de fora)
const INCLUDE_COMPLETO = { cliente: true, colaborador: { select: { id: true, nome: true, especialidade: true } }, servicos: true } as const;
const SEM_CONTATO = 'Não informado';

const gerenciaAgenda = usuarioGerenciaAgenda;

const garantirPermissao = (req: Request, colaboradorId: string) => {
  if (!gerenciaAgenda(req) && getUsuario(req)?.id !== colaboradorId) {
    throw new HttpError(403, 'Você só pode alterar os seus próprios atendimentos.');
  }
};

// Lê data (YYYY-MM-DD) e horário (HH:MM) do corpo; aceita o formato legado com data ISO completa
const lerDataHorario = (date: unknown, time: unknown) => {
  const dataTexto = typeof date === 'string' ? date.trim() : '';
  const data = dataTexto.slice(0, 10);
  const horario = typeof time === 'string' && time.trim() ? time.trim().slice(0, 5) : dataTexto.slice(11, 16);
  if (!dataValida(data) || !horarioValido(horario)) throw new HttpError(400, 'Data ou horário inválido.');
  return { data, horario };
};

type DadosCliente = { clientId?: unknown; clientName?: unknown; contact?: unknown; cpf?: unknown; clientObservation?: unknown };

/**
 * Encontra ou cria o cliente do agendamento.
 * - Nunca procura por nome: homônimos são pessoas diferentes.
 * - Busca por CPF/telefone só para recepção/supervisão (para colaboradores seria um "oráculo" de dados).
 * - Telefone e CPF são gravados só com dígitos, o mesmo formato do totem.
 * - Valores mascarados ("*****") são ignorados, para não apagar o dado real.
 * - Só supervisores alteram telefone/CPF de um cliente já cadastrado.
 * - Anamnese de cliente existente só é alterada por quem tem acesso à ficha de saúde dele.
 */
const ROTULO_STATUS: Record<string, string> = { scheduled: 'agendado', completed: 'concluído', cancelled: 'cancelado', no_show: 'não comparecimento' };

/**
 * Regras de mudança de status:
 * - concluir ou marcar falta só de um agendamento ativo e depois do horário de início;
 * - cancelar só um agendamento ativo;
 * - reativar um cancelado/falta só quem gerencia a agenda (recepção/supervisão): o profissional reativando o
 *   próprio atendimento renovaria o acesso à ficha de saúde do cliente; reabrir um concluído só supervisores.
 */
const erroTransicaoStatus = (atual: string, novo: string, inicio: Date, supervisor: boolean, gerencia: boolean): string | null => {
  if (atual === novo) return null;
  if (novo === 'completed' || novo === 'no_show') {
    if (atual !== 'scheduled') return `Só é possível marcar como ${ROTULO_STATUS[novo]} um agendamento ativo (este está ${ROTULO_STATUS[atual] ?? atual}).`;
    if (inicio.getTime() > Date.now()) return `Este atendimento ainda não começou; não é possível marcá-lo como ${ROTULO_STATUS[novo]}.`;
    return null;
  }
  if (novo === 'cancelled') {
    return atual === 'scheduled' ? null : `Só é possível cancelar um agendamento ativo (este está ${ROTULO_STATUS[atual] ?? atual}).`;
  }
  if (atual === 'completed' && !supervisor) return 'Apenas supervisores podem reabrir um atendimento concluído.';
  if ((atual === 'cancelled' || atual === 'no_show') && !gerencia) {
    return 'Apenas a recepção ou a supervisão podem reativar um agendamento cancelado ou com falta.';
  }
  return null;
};

const resolverCliente = async (
  tx: Prisma.TransactionClient,
  req: Request,
  dados: DadosCliente,
  { clienteAtualId, acessoSaude }: { clienteAtualId?: string; acessoSaude: Set<string> },
) => {
  const supervisor = usuarioEhSupervisor(req);
  const nome = typeof dados.clientName === 'string' ? dados.clientName.trim() : '';
  const telefone = typeof dados.contact === 'string' && dados.contact !== SEM_CONTATO && !valorMascarado(dados.contact)
    ? normalizarTelefone(dados.contact) || undefined
    : undefined;
  const cpf = typeof dados.cpf === 'string' && !valorMascarado(dados.cpf) ? apenasDigitos(dados.cpf) || undefined : undefined;
  const observacao = typeof dados.clientObservation === 'string' ? dados.clientObservation.slice(0, LIMITE_OBSERVACAO) : undefined;

  // Telefone/CPF só são validados quando serão gravados (cliente novo ou edição por supervisor)
  const validarContato = () => {
    if (telefone && !telefoneValido(telefone)) throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
    if (cpf && !cpfValido(cpf)) throw new HttpError(400, MENSAGEM_CPF_INVALIDO);
  };

  let cliente = typeof dados.clientId === 'string' && dados.clientId
    ? await tx.cliente.findUnique({ where: { id: dados.clientId } })
    : null;

  // Colaborador não vincula clientes arbitrários: só o cliente atual do atendimento ou alguém que ele já atendeu
  if (cliente && !gerenciaAgenda(req) && cliente.id !== clienteAtualId) {
    const jaAtendeu = await tx.agendamento.findFirst({
      // Cancelado ou falta não conta como "já atendeu"
      where: { colaboradorId: getUsuario(req)?.id, clienteId: cliente.id, status: { in: ['scheduled', 'completed'] } },
      select: { id: true },
    });
    if (!jaAtendeu) throw new HttpError(403, 'Você só pode agendar clientes que já atendeu. Peça à recepção para vincular este cliente.');
  }

  // Edição sem troca de cliente: mantém o atual quando o nome não mudou
  if (!cliente && clienteAtualId) {
    const atual = await tx.cliente.findUnique({ where: { id: clienteAtualId } });
    if (atual && (!nome || normalizarNome(atual.nome) === normalizarNome(nome))) cliente = atual;
  }
  // Só o cliente aberto na edição tem o cadastro alterado; quem foi achado por CPF/telefone é outra ficha
  const editandoCadastro = Boolean(cliente && clienteAtualId && cliente.id === clienteAtualId);
  if (!cliente && gerenciaAgenda(req)) {
    // CPF identifica a pessoa; telefone pode ser compartilhado (família), então só vale se o nome também conferir
    if (cpf && cpfValido(cpf)) cliente = await tx.cliente.findFirst({ where: { cpf: { in: variantesCpf(cpf) } } });
    if (!cliente && telefone && telefoneValido(telefone)) {
      const mesmoTelefone = await tx.cliente.findMany({ where: { telefone: { in: variantesTelefone(telefone) } } });
      cliente = mesmoTelefone.find((c) => !nome || normalizarNome(c.nome) === normalizarNome(nome)) ?? null;
    }
  }

  if (!cliente) {
    validarContato();
    if (nome.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');
    return tx.cliente.create({
      data: { nome: nome.slice(0, 120), telefone: telefone ?? null, cpf: cpf ?? null, observacao: observacao || null },
    });
  }

  const atualizacao: Prisma.ClienteUpdateInput = {};
  if (!editandoCadastro) {
    // Cliente escolhido na busca ou achado por CPF/telefone: o agendamento usa a ficha como está
    const podeEditarSaudeFicha = supervisor || acessoSaude.has(cliente.id);
    return podeEditarSaudeFicha && observacao !== undefined && observacao !== cliente.observacao
      ? tx.cliente.update({ where: { id: cliente.id }, data: { observacao } })
      : cliente;
  }
  // Edição do cliente do atendimento: alterações sem permissão viram erro explícito, nunca são descartadas em silêncio
  if (nome.length >= 2 && normalizarNome(nome) !== normalizarNome(cliente.nome)) {
    if (!gerenciaAgenda(req)) throw new HttpError(403, 'Apenas a recepção ou supervisores podem alterar o nome do cliente.');
    atualizacao.nome = nome.slice(0, 120);
  }
  if (!supervisor && ((telefone && telefone !== cliente.telefone) || (cpf && cpf !== cliente.cpf))) {
    throw new HttpError(403, 'Apenas supervisores podem alterar telefone ou CPF de um cliente já cadastrado.');
  }
  if (supervisor) validarContato();
  if (supervisor && telefone && telefone !== cliente.telefone) atualizacao.telefone = telefone;
  if (supervisor && cpf && cpf !== cliente.cpf) atualizacao.cpf = cpf;
  const podeEditarSaude = supervisor || acessoSaude.has(cliente.id);
  if (podeEditarSaude && observacao !== undefined && observacao !== cliente.observacao) atualizacao.observacao = observacao;
  return Object.keys(atualizacao).length > 0
    ? tx.cliente.update({ where: { id: cliente.id }, data: atualizacao })
    : cliente;
};

// Observações do agendamento (podem conter a anamnese): texto aparado e limitado; vazio vira null
const lerObservacao = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().slice(0, LIMITE_OBSERVACAO);
  return texto || null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAgendamentosRouter(notificar: Notificar) {
  const router = Router();

  router.get('/agendamentos', verificarToken, async (req, res) => {
    try {
      // Recepção/supervisão veem a agenda da casa; o profissional, só os próprios atendimentos
      // Cancelados e não comparecimentos ficam no histórico do banco, fora das agendas.
      // Agenda: só o último ano (?desde= pode encurtar, nunca alongar). Histórico de um cliente (?clienteId=): período todo.
      const clienteIdBruto = req.query.clienteId;
      if (clienteIdBruto !== undefined && (typeof clienteIdBruto !== 'string' || !UUID_REGEX.test(clienteIdBruto))) {
        throw new HttpError(400, 'Parâmetro "clienteId" inválido.');
      }
      const clienteId = clienteIdBruto ?? '';
      const filtroPeriodo = clienteId ? { clienteId } : { data: { gte: lerDesde(req.query.desde) } };
      const agendamentos = await prisma.agendamento.findMany({
        where: {
          ...(gerenciaAgenda(req) ? {} : { colaboradorId: getUsuario(req)?.id }),
          // Status vazio é tratado como "scheduled" (padrão da coluna). A agenda mostra só ativos e concluídos;
          // o histórico do cliente também mostra as faltas (no_show), só esconde os cancelados.
          OR: [{ status: { in: clienteId ? ['scheduled', 'completed', 'no_show'] : ['scheduled', 'completed'] } }, { status: null }],
          ...filtroPeriodo,
        },
        include: INCLUDE_COMPLETO,
        // Histórico: os mais recentes primeiro, com teto (a tela mostra no máximo isso)
        orderBy: { data: clienteId ? 'desc' : 'asc' },
        ...(clienteId ? { take: LIMITE_HISTORICO_CLIENTE } : {}),
      });
      // Histórico tem dados de saúde: o acesso fica gravado antes da resposta (sem registro, sem dados)
      if (clienteId) {
        await prisma.acessoHistoricoCliente.create({
          data: { colaboradorId: getUsuario(req)?.id ?? 'desconhecido', clienteId, ip: ipDoCliente(req), registros: agendamentos.length },
        });
      }
      const acesso = await clientesComAcessoSaude(req);
      res.json(agendamentos.map((ag) => prepararAgendamento(ag, req, acesso)));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar agendamentos');
    }
  });

  router.get('/agendamentos/relatorio/concluidos', verificarToken, async (req, res) => {
    try {
      // Recepção/supervisão veem o relatório da equipe; colaborador, só os próprios atendimentos
      const concluidos = await prisma.agendamento.findMany({
        where: { status: 'completed', ...(gerenciaAgenda(req) ? {} : { colaboradorId: getUsuario(req)?.id }) },
        include: INCLUDE_COMPLETO,
        orderBy: { data: 'desc' },
      });
      const acesso = await clientesComAcessoSaude(req);
      res.json(concluidos.map((ag) => prepararAgendamento(ag, req, acesso)));
    } catch (error) {
      responderErro(res, error, 'Erro ao gerar relatório');
    }
  });

  router.post('/agendamentos', verificarToken, async (req, res) => {
    try {
      const colaboradorId = req.body.collaboratorId || req.body.assignedEmployeeId;
      if (typeof colaboradorId !== 'string' || !colaboradorId) {
        return res.status(400).json({ erro: 'Profissional do agendamento não informado.' });
      }
      // Colaborador só agenda para si mesmo; recepção e supervisão agendam para qualquer profissional
      garantirPermissao(req, colaboradorId);
      const { data, horario } = lerDataHorario(req.body.date, req.body.time);
      const inicio = instanteNoFuso(data, horario);
      const acessoSaude = await clientesComAcessoSaude(req);

      const novo = await transacaoSerializavel(async (tx) => {
        await travarChave(tx, `agenda:${colaboradorId}:${data}`);

        const servicos = await buscarServicosPorNome(tx, req.body.serviceNames ?? req.body.services);
        const erroHorario = validarHorarioAgendamento(data, horario, duracaoTotal(servicos), { agora: new Date() });
        if (erroHorario) throw new HttpError(400, erroHorario);

        const indisponivel = await validarDisponibilidadeProfissional(tx, colaboradorId, inicio, servicos);
        if (indisponivel) throw new HttpError(indisponivel.status, indisponivel.erro);

        const cliente = await resolverCliente(tx, req, req.body, { acessoSaude });
        return tx.agendamento.create({
          data: {
            data: inicio,
            reservaOrigem: gerenciaAgenda(req) ? 'interno' : ORIGEM_COLABORADOR,
            observacoesSaude: lerObservacao(req.body.observation),
            colaborador: { connect: { id: colaboradorId } },
            cliente: { connect: { id: cliente.id } },
            servicos: { connect: servicos.map((s) => ({ id: s.id })) },
          },
          include: INCLUDE_COMPLETO,
        });
      });

      notificar();
      res.status(201).json(prepararAgendamento(novo, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao salvar agendamento');
    }
  });

  router.put('/agendamentos/:id', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const antigo = await prisma.agendamento.findUnique({ where: { id }, include: { servicos: true } });
      if (!antigo) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
      garantirPermissao(req, antigo.colaboradorId);

      const novoColaboradorId = req.body.colaboradorId || req.body.collaboratorId || req.body.assignedEmployeeId || antigo.colaboradorId;
      if (novoColaboradorId !== antigo.colaboradorId && !gerenciaAgenda(req)) {
        return res.status(403).json({ erro: 'Apenas a recepção ou supervisores podem trocar o profissional do atendimento.' });
      }

      const atual = partesNoFuso(antigo.data);
      const mudouHorario = req.body.date !== undefined || req.body.time !== undefined;
      const { data, horario } = mudouHorario
        ? lerDataHorario(
          req.body.date ?? atual.data,
          req.body.time ?? (String(req.body.date ?? '').includes('T') ? undefined : atual.horario),
        )
        : { data: atual.data, horario: atual.horario };
      const inicio = instanteNoFuso(data, horario);
      const acessoSaude = await clientesComAcessoSaude(req);

      const versaoEsperada = typeof req.body.version === 'string' ? req.body.version : undefined;

      const atualizado = await transacaoSerializavel(async (tx) => {
        await travarChave(tx, `agenda:${novoColaboradorId}:${data}`);

        // Quem abriu o formulário antes de outra pessoa salvar não sobrescreve a alteração dela
        if (versaoEsperada) {
          const atual = await tx.agendamento.findUnique({ where: { id }, select: { atualizadoEm: true } });
          if (!atual) throw new HttpError(404, 'Agendamento não encontrado.');
          if (atual.atualizadoEm.toISOString() !== versaoEsperada) {
            throw new HttpError(409, 'Este agendamento foi alterado por outra pessoa enquanto você editava. Feche e abra de novo para ver a versão atual.');
          }
        }

        const nomesServicos = req.body.serviceNames ?? req.body.services ?? antigo.servicos.map((s) => s.nome);
        const servicos = await buscarServicosPorNome(tx, nomesServicos);
        const duracao = duracaoTotal(servicos);
        if (mudouHorario && inicio.getTime() !== antigo.data.getTime()) {
          const erroHorario = validarHorarioAgendamento(data, horario, duracao, { agora: new Date() });
          if (erroHorario) throw new HttpError(400, erroHorario);
        } else if (horarioParaMinutos(horario) + duracao > HORA_FECHAMENTO * 60) {
          // Mesmo sem mudar o horário, novos serviços não podem empurrar o fim para depois do fechamento
          throw new HttpError(400, `Com esses serviços o atendimento terminaria depois do fechamento (${HORA_FECHAMENTO_TEXTO}).`);
        }

        const indisponivel = await validarDisponibilidadeProfissional(tx, novoColaboradorId, inicio, servicos, { ignorarAgendamentoId: id });
        if (indisponivel) throw new HttpError(indisponivel.status, indisponivel.erro);

        const dados: Prisma.AgendamentoUncheckedUpdateInput = {
          data: inicio,
          colaboradorId: novoColaboradorId,
          servicos: { set: servicos.map((s) => ({ id: s.id })) },
        };
        // Observações ficam sob a regra da ficha de saúde: quem recebe o campo mascarado não pode sobrescrevê-lo
        if (req.body.observation !== undefined && (usuarioEhSupervisor(req) || acessoSaude.has(antigo.clienteId))) {
          dados.observacoesSaude = lerObservacao(req.body.observation);
        }
        // Remarcado pelo próprio profissional: a nova data não renova o acesso à ficha de saúde
        if (!gerenciaAgenda(req) && inicio.getTime() !== antigo.data.getTime()) dados.reservaOrigem = ORIGEM_COLABORADOR;
        if (req.body.clientName !== undefined || req.body.clientId !== undefined) {
          const cliente = await resolverCliente(tx, req, req.body, { clienteAtualId: antigo.clienteId, acessoSaude });
          dados.clienteId = cliente.id;
          // Cliente trocado pelo próprio colaborador não libera a ficha de saúde (ver clientesComAcessoSaude)
          if (cliente.id !== antigo.clienteId && !gerenciaAgenda(req)) dados.reservaOrigem = ORIGEM_COLABORADOR;
        }
        return tx.agendamento.update({ where: { id }, data: dados, include: INCLUDE_COMPLETO });
      });

      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar agendamento');
    }
  });

  const alterarStatus = async (req: Request, id: string, status: unknown) => {
    if (!(STATUS_AGENDAMENTO as readonly unknown[]).includes(status)) {
      throw new HttpError(400, `Status inválido. Use: ${STATUS_AGENDAMENTO.join(', ')}.`);
    }
    const agendamento = await prisma.agendamento.findUnique({ where: { id }, include: { servicos: true, cliente: true, colaborador: true } });
    if (!agendamento) throw new HttpError(404, 'Agendamento não encontrado.');
    garantirPermissao(req, agendamento.colaboradorId);

    const erroTransicao = erroTransicaoStatus(agendamento.status ?? 'scheduled', status as string, agendamento.data, usuarioEhSupervisor(req), gerenciaAgenda(req));
    if (erroTransicao) throw new HttpError(409, erroTransicao);
    if (agendamento.status === status) return agendamento;

    const reativando = status === 'scheduled';
    if (!reativando) {
      return prisma.agendamento.update({ where: { id }, data: { status: status as string }, include: INCLUDE_COMPLETO });
    }
    // Reativar exige que o horário ainda esteja livre (senão vira overbooking)
    return transacaoSerializavel(async (tx) => {
      await travarChave(tx, `agenda:${agendamento.colaboradorId}:${partesNoFuso(agendamento.data).data}`);
      const indisponivel = await validarDisponibilidadeProfissional(tx, agendamento.colaboradorId, agendamento.data, agendamento.servicos, { ignorarAgendamentoId: id });
      if (indisponivel) throw new HttpError(409, `Não é possível reativar: ${indisponivel.erro}`);
      return tx.agendamento.update({ where: { id }, data: { status: 'scheduled' }, include: INCLUDE_COMPLETO });
    });
  };

  router.patch('/agendamentos/:id/status', verificarToken, async (req, res) => {
    try {
      const atualizado = await alterarStatus(req, req.params.id, req.body.status);
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar status do agendamento');
    }
  });

  router.patch('/agendamentos/:id/concluir', verificarToken, async (req, res) => {
    try {
      const atualizado = await alterarStatus(req, req.params.id, 'completed');
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao concluir agendamento');
    }
  });

  // Realocar o atendimento para outro profissional (recepção e supervisores)
  const realocar = async (req: Request, id: string, destinoId: unknown) => {
    if (!gerenciaAgenda(req)) throw new HttpError(403, 'Apenas a recepção ou supervisores podem realocar atendimentos.');
    if (typeof destinoId !== 'string' || !destinoId) throw new HttpError(400, 'Informe o colaborador de destino.');

    return transacaoSerializavel(async (tx) => {
      const agendamento = await tx.agendamento.findUnique({ where: { id }, include: { servicos: true } });
      if (!agendamento) throw new HttpError(404, 'Agendamento não encontrado.');
      await travarChave(tx, `agenda:${destinoId}:${partesNoFuso(agendamento.data).data}`);

      const indisponivel = await validarDisponibilidadeProfissional(tx, destinoId, agendamento.data, agendamento.servicos, { ignorarAgendamentoId: id });
      if (indisponivel) throw new HttpError(indisponivel.status, indisponivel.erro);

      return tx.agendamento.update({ where: { id }, data: { colaboradorId: destinoId }, include: INCLUDE_COMPLETO });
    });
  };

  router.patch('/agendamentos/:id/reassign', verificarToken, async (req, res) => {
    try {
      const atualizado = await realocar(req, req.params.id, req.body.newEmployeeId);
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao realocar agendamento');
    }
  });

  // Exclusão definitiva (apenas supervisores). Para desmarcar mantendo histórico, use o status "cancelled".
  router.delete('/agendamentos/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const removido = await prisma.agendamento.deleteMany({ where: { id: req.params.id } });
      if (removido.count === 0) return res.status(404).json({ erro: 'Agendamento não encontrado. Ele pode já ter sido excluído.' });
      notificar();
      res.json({ mensagem: 'Agendamento excluído com sucesso' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir agendamento');
    }
  });

  return router;
}
