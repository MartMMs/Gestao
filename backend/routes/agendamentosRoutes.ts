import { Router, Request } from 'express';
import { Prisma, type Cliente } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, ipDoCliente, responderErro, type Notificar } from '../lib/http';
import { transacaoComTravas, travarAgenda, travarAgendamento, travarChave } from '../lib/transacao';
import { NOME_CLIENTE_REMOVIDO, clienteComMesmoNome, mensagemNomeDuplicado, travarNomeCliente } from '../lib/clientes';
import { ORIGEM_COLABORADOR, ORIGEM_TOTEM, ORIGEM_TOTEM_CHECKIN, clientesComAcessoSaude, podeVerSaude, prepararAgendamento } from '../lib/privacidade';
import { atendimentoSobrepostoDoCliente, validarDisponibilidadeProfissional } from '../services/agendaService';
import { buscarServicosPorNome } from '../services/servicoService';
import { erroNomeCliente, limparTexto } from '../../shared/clientes';
import { getEmpresaConfig } from '../services/configService';
import {
  CODIGO_ANAMNESE_OBRIGATORIA,
  MENSAGEM_ANAMNESE_OBRIGATORIA,
  MENSAGEM_FICHA_TOTEM_RESERVADA,
  aparaObservacao,
  atualizarSomenteFichaJson,
  forjaFichaDoTotem,
  temFichaAnamnese,
} from '../../shared/anamnese';
import { comissaoDosServicos, mesmosServicos, recalcularValores, valorDosServicos } from '../lib/valores';
import { lerDesde } from '../lib/periodo';
import { registrarAuditoria } from '../lib/auditoria';
import { CODIGO_FORA_DA_AGENDA, CODIGO_VERSAO_AUSENTE, CODIGO_VERSAO_DESATUALIZADA, statusFechado } from '../../shared/statusAgendamento';
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
    throw new HttpError(403, 'Você só pode alterar os seus próprios atendimentos.', CODIGO_FORA_DA_AGENDA);
  }
};

const MENSAGEM_VERSAO_DESATUALIZADA = 'Este agendamento mudou desde que a tela foi carregada (outra pessoa ou outra aba salvou antes). A agenda foi atualizada: confira e tente de novo.';

// Toda escrita num agendamento leva a versão que a tela leu (atualizadoEm): sem ela não dá para saber se
// outra pessoa salvou antes, e quem salvasse por último apagaria a alteração dela
const exigirVersao = (versao: unknown): string => {
  if (typeof versao !== 'string' || !versao) {
    throw new HttpError(428, 'Versão do agendamento ausente. Atualize a agenda e tente de novo.', CODIGO_VERSAO_AUSENTE);
  }
  return versao;
};
const conferirVersao = (atualizadoEm: Date, versao: string) => {
  if (atualizadoEm.toISOString() !== versao) throw new HttpError(409, MENSAGEM_VERSAO_DESATUALIZADA, CODIGO_VERSAO_DESATUALIZADA);
};

// Como o atendimento aparece no histórico de alterações: pelo código do cliente, nunca pelo nome (o nome
// sumiria do cadastro na exclusão, mas ficaria no histórico)
const alvoDoAtendimento = (ag: { data: Date; cliente?: { codigo: number } | null; colaborador?: { nome: string } | null }) => {
  const { data, horario } = partesNoFuso(ag.data);
  return `Atendimento do cliente #${ag.cliente?.codigo ?? '?'} com ${ag.colaborador?.nome ?? 'profissional'} em ${data.split('-').reverse().join('/')} ${horario}`;
};

// Mesma pessoa não está em dois lugares ao mesmo tempo (regra da agenda interna em services/agendaService)
const conflitoDoCliente = async (tx: Prisma.TransactionClient, clienteId: string, inicio: Date, duracaoMin: number, ignorarId?: string) => {
  const outro = await atendimentoSobrepostoDoCliente(tx, clienteId, inicio, duracaoMin, ignorarId);
  if (outro) throw new HttpError(409, `Este cliente já tem atendimento às ${partesNoFuso(outro.data).horario} com ${outro.colaborador.nome}, no mesmo período.`);
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
  { clienteAtualId, acessoSaude, exigirAnamnese = false }: { clienteAtualId?: string; acessoSaude: Set<string>; exigirAnamnese?: boolean },
) => {
  const supervisor = usuarioEhSupervisor(req);
  const nome = limparTexto(dados.clientName);
  const telefone = typeof dados.contact === 'string' && dados.contact !== SEM_CONTATO && !valorMascarado(dados.contact)
    ? normalizarTelefone(dados.contact) || undefined
    : undefined;
  const cpf = typeof dados.cpf === 'string' && !valorMascarado(dados.cpf) ? apenasDigitos(dados.cpf) || undefined : undefined;
  // Texto sem nenhum dígito ("telefone", "abc") é erro de digitação: avisa em vez de descartar o campo calado
  if (typeof dados.contact === 'string' && dados.contact.trim() && dados.contact !== SEM_CONTATO && !valorMascarado(dados.contact) && !telefone) {
    throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
  }
  if (typeof dados.cpf === 'string' && dados.cpf.trim() && !valorMascarado(dados.cpf) && !cpf) throw new HttpError(400, MENSAGEM_CPF_INVALIDO);
  const observacao = typeof dados.clientObservation === 'string' ? dados.clientObservation.slice(0, LIMITE_OBSERVACAO) : undefined;
  // Conferido contra a ficha gravada do cliente escolhido (ou vazia, para cliente novo) antes de qualquer gravação
  const recusarFichaForjada = (atual: string | null | undefined) => {
    if (forjaFichaDoTotem(observacao, atual)) throw new HttpError(400, MENSAGEM_FICHA_TOTEM_RESERVADA);
  };

  // Telefone/CPF só são validados quando serão gravados (cliente novo ou edição por quem tem permissão)
  const validarContato = () => {
    if (telefone && !telefoneValido(telefone)) throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
    if (cpf && !cpfValido(cpf)) throw new HttpError(400, MENSAGEM_CPF_INVALIDO);
  };

  let cliente = typeof dados.clientId === 'string' && dados.clientId
    ? await tx.cliente.findUnique({ where: { id: dados.clientId } })
    : null;
  // Cliente excluído (anonimizado) não recebe agendamentos novos
  if (cliente?.removidoEm) throw new HttpError(404, 'Cliente não encontrado. Ele pode ter sido excluído.');

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
    if (atual?.removidoEm) throw new HttpError(409, 'O cadastro deste cliente foi excluído. Informe os dados do cliente novamente.');
    if (atual && (!nome || normalizarNome(atual.nome) === normalizarNome(nome))) cliente = atual;
  }
  // Só o cliente aberto na edição tem o cadastro alterado; quem foi achado por CPF/telefone é outra ficha
  // Ficha anonimizada nunca volta a receber nome, telefone ou CPF (isso a reidentificaria)
  const editandoCadastro = Boolean(cliente && clienteAtualId && cliente.id === clienteAtualId && !cliente.removidoEm);
  if (!cliente && nome) await travarNomeCliente(tx, nome);
  if (!cliente && gerenciaAgenda(req)) {
    // CPF identifica a pessoa; telefone pode ser compartilhado (família), então só vale se o nome também conferir
    if (cpf && cpfValido(cpf)) {
      // Dois envios com o mesmo CPF e nomes diferentes não pegam a mesma trava de nome
      await travarChave(tx, `cliente-cpf:${cpf}`);
      cliente = await tx.cliente.findFirst({ where: { cpf: { in: variantesCpf(cpf) } } });
    }
    if (!cliente && telefone && telefoneValido(telefone)) {
      const mesmoTelefone = await tx.cliente.findMany({ where: { telefone: { in: variantesTelefone(telefone) } } });
      cliente = mesmoTelefone.find((c) => !nome || normalizarNome(c.nome) === normalizarNome(nome)) ?? null;
    }
  }

  if (cliente) {
    // Relido depois da trava (a mesma da exclusão): um cadastro excluído no meio da marcação não recebe o atendimento
    await travarChave(tx, `cliente:${cliente.id}`);
    cliente = await tx.cliente.findUnique({ where: { id: cliente.id } });
    if (!cliente || cliente.removidoEm) throw new HttpError(409, 'O cadastro deste cliente acabou de ser excluído. Informe os dados do cliente novamente.');
  }
  if (!cliente) {
    // Na edição, quem não gerencia a agenda não troca o cliente (a tela trava o campo; a API também): um nome novo
    // criaria outro cadastro e tiraria o atendimento da ficha certa
    if (clienteAtualId && !gerenciaAgenda(req)) {
      throw new HttpError(403, 'Só a recepção ou a supervisão trocam o cliente de um atendimento.');
    }
    validarContato();
    if (nome.length < 2) throw new HttpError(400, 'Informe o nome do cliente.');
    // Cliente novo: mesma regra do cadastro (sem HTML nem fórmula de planilha no nome)
    const erroNome = erroNomeCliente(nome);
    if (erroNome) throw new HttpError(400, erroNome);
    if (normalizarNome(nome) === normalizarNome(NOME_CLIENTE_REMOVIDO)) throw new HttpError(400, 'Este nome é reservado para cadastros excluídos. Informe o nome do cliente.');
    const homonimo = await clienteComMesmoNome(tx, nome);
    if (homonimo) {
      // Quem não gerencia a agenda não vê a carteira toda: a mensagem não confirma nome nem código
      throw new HttpError(409, gerenciaAgenda(req)
        ? mensagemNomeDuplicado(homonimo, 'marcacao')
        : 'Já existe um cadastro com esse nome. Peça à recepção para vincular o cliente ao atendimento.');
    }
    recusarFichaForjada(null);
    return tx.cliente.create({
      data: { nome: nome.slice(0, 120), telefone: telefone ?? null, cpf: cpf ?? null, observacao: observacao || null },
    });
  }

  recusarFichaForjada(cliente.observacao);
  const podeEditarSaude = podeVerSaude(req, cliente.id, acessoSaude);
  const validarNaoApagarFichaObrigatoria = (novaObs: string | null | undefined) => {
    if (exigirAnamnese && temFichaAnamnese(cliente!.observacao) && !temFichaAnamnese(novaObs)) {
      throw new HttpError(400, 'A empresa exige ficha de anamnese: a ficha deste cliente não pode ser apagada.', CODIGO_ANAMNESE_OBRIGATORIA);
    }
  };

  const atualizacao: Prisma.ClienteUpdateInput = {};
  if (!editandoCadastro) {
    // Cliente escolhido na busca ou achado por CPF/telefone
    if (podeEditarSaude && !cliente.removidoEm && observacao !== undefined && observacao !== cliente.observacao) {
      validarNaoApagarFichaObrigatoria(observacao);
      return tx.cliente.update({ where: { id: cliente.id }, data: { observacao } });
    }
    // Recepção pode atualizar a ficha JSON no balcão ao marcar sem ver nem perder a nota anterior
    if (!podeEditarSaude && gerenciaAgenda(req) && !cliente.removidoEm && observacao) {
      const combinada = atualizarSomenteFichaJson(cliente.observacao, observacao);
      if (combinada && combinada.length > LIMITE_OBSERVACAO) {
        throw new HttpError(400, 'A ficha de anamnese ficou grande demais. Resuma as observações.');
      }
      if (combinada && combinada !== cliente.observacao) {
        const atualizado = await tx.cliente.update({ where: { id: cliente.id }, data: { observacao: combinada } });
        await registrarAuditoria(req, {
          acao: 'cliente.anamnese', alvo: `Cliente #${cliente.codigo}`, tx,
          antes: { fichaAnamnese: temFichaAnamnese(cliente.observacao) }, depois: { fichaAnamnese: true },
        });
        return atualizado;
      }
    }
    return cliente;
  }
  // Edição do cliente do atendimento: alterações sem permissão viram erro explícito, nunca são descartadas em silêncio
  if (nome.length >= 2 && normalizarNome(nome) !== normalizarNome(cliente.nome)) {
    if (!gerenciaAgenda(req)) throw new HttpError(403, 'Apenas a recepção ou supervisores podem alterar o nome do cliente.');
    const erroNome = erroNomeCliente(nome);
    if (erroNome) throw new HttpError(400, erroNome);
    const homonimo = await clienteComMesmoNome(tx, nome, cliente.id);
    if (homonimo) {
      // Quem não gerencia a agenda não vê a carteira toda: a mensagem não confirma nome nem código
      throw new HttpError(409, gerenciaAgenda(req)
        ? mensagemNomeDuplicado(homonimo, 'edicao')
        : 'Já existe um cadastro com esse nome. Peça à recepção para vincular o cliente ao atendimento.');
    }
    atualizacao.nome = nome.slice(0, 120);
  }
  if (!gerenciaAgenda(req) && telefone && telefone !== cliente.telefone) {
    throw new HttpError(403, 'Apenas a recepção ou supervisores podem alterar o telefone de um cliente já cadastrado.');
  }
  if (!supervisor && cpf && cpf !== cliente.cpf) {
    throw new HttpError(403, 'Apenas supervisores podem alterar o CPF de um cliente já cadastrado.');
  }
  if (gerenciaAgenda(req) && telefone && telefone !== cliente.telefone) {
    if (!telefoneValido(telefone)) throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
    atualizacao.telefone = telefone;
  }
  if (supervisor) validarContato();
  if (supervisor && cpf && cpf !== cliente.cpf) atualizacao.cpf = cpf;
  if (podeEditarSaude && observacao !== undefined && observacao !== cliente.observacao) {
    validarNaoApagarFichaObrigatoria(observacao);
    atualizacao.observacao = observacao;
  } else if (!podeEditarSaude && gerenciaAgenda(req) && observacao) {
    const combinada = atualizarSomenteFichaJson(cliente.observacao, observacao);
    if (combinada && combinada.length > LIMITE_OBSERVACAO) {
      throw new HttpError(400, 'A ficha de anamnese ficou grande demais. Resuma as observações.');
    }
    if (combinada && combinada !== cliente.observacao) {
      atualizacao.observacao = combinada;
      await registrarAuditoria(req, {
        acao: 'cliente.anamnese', alvo: `Cliente #${cliente.codigo}`, tx,
        antes: { fichaAnamnese: temFichaAnamnese(cliente.observacao) }, depois: { fichaAnamnese: true },
      });
    }
  }
  return Object.keys(atualizacao).length > 0
    ? tx.cliente.update({ where: { id: cliente.id }, data: atualizacao })
    : cliente;
};

/**
 * Chave "exigir ficha de anamnese": o cliente do atendimento precisa ter ficha. A que falta pode vir no pedido
 * (clientObservation) de quem marca, mesmo sem acesso à saúde (recepção): ela é JUNTADA à observação que o cadastro
 * já tinha, nunca a substitui (quem não vê a observação não pode apagá-la), e a gravação vai para a auditoria sem o
 * conteúdo. A ficha forjada do totem já foi recusada em resolverCliente.
 */
const garantirFichaAnamnese = async (
  tx: Prisma.TransactionClient,
  req: Request,
  cliente: Cliente,
  fichaEnviada: unknown,
  acessoSaude?: Set<string>,
) => {
  if (temFichaAnamnese(cliente.observacao)) return cliente;
  // Tamanho antes de ler: o corpo pode ter até 100 kB e a leitura tenta cada marcador do texto
  if (typeof fichaEnviada === 'string' && fichaEnviada.length > LIMITE_OBSERVACAO) {
    throw new HttpError(400, 'A ficha de anamnese ficou grande demais. Resuma as observações.');
  }
  if (typeof fichaEnviada !== 'string' || !temFichaAnamnese(fichaEnviada)) {
    throw new HttpError(400, MENSAGEM_ANAMNESE_OBRIGATORIA, CODIGO_ANAMNESE_OBRIGATORIA);
  }
  const veSaude = acessoSaude ? podeVerSaude(req, cliente.id, acessoSaude) : usuarioEhSupervisor(req);
  let observacao: string;
  if (veSaude) {
    const anterior = cliente.observacao ?? '';
    const nota = aparaObservacao(anterior);
    const ficha = aparaObservacao(fichaEnviada);
    observacao = nota && !ficha.startsWith(nota) ? `${nota}\n${ficha}` : ficha;
  } else {
    // Quem não vê a observação (recepção) grava apenas o bloco __ANAMNESE_JSON__, sem texto livre e sem oráculo de startsWith
    const combinada = atualizarSomenteFichaJson(cliente.observacao, fichaEnviada);
    if (!combinada) throw new HttpError(400, MENSAGEM_ANAMNESE_OBRIGATORIA, CODIGO_ANAMNESE_OBRIGATORIA);
    observacao = combinada;
  }
  if (observacao.length > LIMITE_OBSERVACAO) throw new HttpError(400, 'A ficha de anamnese ficou grande demais. Resuma as observações.');
  // Conferida no texto exato que vai ser gravado (a checagem de resolverCliente vê o texto cortado, que espaços no
  // começo deixavam passar)
  if (forjaFichaDoTotem(observacao, cliente.observacao)) throw new HttpError(400, MENSAGEM_FICHA_TOTEM_RESERVADA);
  // O que vale é o texto gravado: juntar com a observação anterior não pode deixar o cliente sem ficha
  if (!temFichaAnamnese(observacao)) throw new HttpError(400, MENSAGEM_ANAMNESE_OBRIGATORIA, CODIGO_ANAMNESE_OBRIGATORIA);
  const atualizado = await tx.cliente.update({ where: { id: cliente.id }, data: { observacao } });
  await registrarAuditoria(req, {
    acao: 'cliente.anamnese', alvo: `Cliente #${cliente.codigo}`, tx,
    antes: { fichaAnamnese: false }, depois: { fichaAnamnese: true },
  });
  return atualizado;
};

// Observações do agendamento (podem conter a anamnese): texto aparado e limitado; vazio vira null
const lerObservacao = (valor: unknown, atual: string | null = null): string | null => {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim().slice(0, LIMITE_OBSERVACAO);
  if (!texto) return null;
  if (forjaFichaDoTotem(texto, atual)) throw new HttpError(400, MENSAGEM_FICHA_TOTEM_RESERVADA);
  return texto;
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
          // Status vazio é tratado como "scheduled" (padrão da coluna). Agenda e histórico mostram ativos,
          // concluídos e faltas (a falta fica visível e pode ser reaberta); só os cancelados ficam de fora.
          OR: [{ status: { in: ['scheduled', 'completed', 'no_show'] } }, { status: null }],
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
      const { exigirAnamnese } = await getEmpresaConfig();

      const novo = await transacaoComTravas(async (tx) => {
        await travarAgenda(tx, colaboradorId);

        const servicos = await buscarServicosPorNome(tx, req.body.serviceNames ?? req.body.services);
        const erroHorario = validarHorarioAgendamento(data, horario, duracaoTotal(servicos), { agora: new Date() });
        if (erroHorario) throw new HttpError(400, erroHorario);

        const indisponivel = await validarDisponibilidadeProfissional(tx, colaboradorId, inicio, servicos);
        if (indisponivel) throw new HttpError(indisponivel.status, indisponivel.erro);

        let cliente = await resolverCliente(tx, req, req.body, { acessoSaude, exigirAnamnese });
        if (exigirAnamnese) cliente = await garantirFichaAnamnese(tx, req, cliente, req.body.clientObservation, acessoSaude);
        await conflitoDoCliente(tx, cliente.id, inicio, duracaoTotal(servicos));
        return tx.agendamento.create({
          data: {
            data: inicio,
            reservaOrigem: gerenciaAgenda(req) ? 'interno' : ORIGEM_COLABORADOR,
            observacoesSaude: lerObservacao(req.body.observation, null),
            colaborador: { connect: { id: colaboradorId } },
            cliente: { connect: { id: cliente.id } },
            servicos: { connect: servicos.map((s) => ({ id: s.id })) },
            // Preço do dia gravado: mudar o preço do serviço depois não reescreve o faturamento
            valorTotal: valorDosServicos(servicos),
            valorComissao: comissaoDosServicos(servicos),
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
      const antigo = await prisma.agendamento.findUnique({ where: { id }, include: { cliente: { select: { removidoEm: true } } } });
      if (!antigo) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
      garantirPermissao(req, antigo.colaboradorId);
      // Atendimento de cliente excluído é só histórico: não se edita
      if (antigo.cliente?.removidoEm) return res.status(409).json({ erro: 'O cadastro deste cliente foi excluído; o atendimento fica apenas no histórico.' });

      const novoColaboradorId = req.body.colaboradorId || req.body.collaboratorId || req.body.assignedEmployeeId || antigo.colaboradorId;
      if (novoColaboradorId !== antigo.colaboradorId && !gerenciaAgenda(req)) {
        return res.status(403).json({ erro: 'Apenas a recepção ou supervisores podem trocar o profissional do atendimento.' });
      }

      const { exigirAnamnese } = await getEmpresaConfig();
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

      // Sem a versão não dá para saber se outra pessoa salvou antes: quem salvasse por último apagaria a alteração dela
      const versaoEsperada = exigirVersao(req.body.version);

      const atualizado = await transacaoComTravas(async (tx) => {
        await travarAgenda(tx, novoColaboradorId);
        await travarAgendamento(tx, id);

        // Relido dentro da transação: valores e serviços são calculados sobre o estado atual, não sobre a leitura de antes
        const antigo = await tx.agendamento.findUnique({
          where: { id }, include: { servicos: true, cliente: { select: { codigo: true } }, colaborador: { select: { nome: true } } },
        });
        if (!antigo) throw new HttpError(404, 'Agendamento não encontrado.');
        // Conferido de novo depois da trava da exclusão: a observação de saúde não volta para uma ficha excluída
        await travarChave(tx, `cliente:${antigo.clienteId}`);
        if (!(await tx.cliente.findFirst({ where: { id: antigo.clienteId, removidoEm: null }, select: { id: true } }))) {
          throw new HttpError(409, 'O cadastro deste cliente foi excluído; o atendimento fica apenas no histórico.');
        }
        // Quem abriu o formulário antes de outra pessoa salvar não sobrescreve a alteração dela
        conferirVersao(antigo.atualizadoEm, versaoEsperada);

        const nomesServicos = req.body.serviceNames ?? req.body.services ?? antigo.servicos.map((s) => s.nome);
        const servicos = await buscarServicosPorNome(tx, nomesServicos, { jaVinculados: antigo.servicos.map((s) => s.id) });
        // Concluído, falta ou cancelado é registro fechado (entra no faturamento e na comissão): só as observações mudam
        const encerrado = statusFechado(antigo.status);
        const servicosIguais = mesmosServicos(servicos, antigo.servicos);
        if (encerrado && (inicio.getTime() !== antigo.data.getTime() || novoColaboradorId !== antigo.colaboradorId || !servicosIguais)) {
          throw new HttpError(409, 'Atendimento já encerrado (concluído, falta ou cancelado): não dá para mudar horário, profissional ou serviços.');
        }
        // Serviços definem valor e comissão: depois que o atendimento começou, o próprio profissional não os troca
        // (senão ajustaria a própria comissão antes de concluir). A recepção corrige, e fica no histórico.
        if (!servicosIguais && !gerenciaAgenda(req) && antigo.data.getTime() <= Date.now()) {
          throw new HttpError(403, 'Depois do início do atendimento, só a recepção ou a supervisão alteram os serviços.');
        }

        // Encerrado não ocupa mais a agenda: corrigir a observação não pode esbarrar em horário reocupado,
        // escala nova ou profissional desligado
        if (!encerrado) {
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
        }

        const dados: Prisma.AgendamentoUncheckedUpdateInput = {
          data: inicio,
          colaboradorId: novoColaboradorId,
          servicos: { set: servicos.map((s) => ({ id: s.id })) },
          // Só muda quando a lista de serviços muda ou um dos campos está vazio (ver shared/valores.ts)
          ...recalcularValores(antigo, servicos),
        };
        // Observações ficam sob a regra da ficha de saúde. Sem acesso, o campo chega vazio (mascarado) e é ignorado;
        // texto novo é recusado com erro explícito, nunca descartado em silêncio com "atualizado"
        if (req.body.observation !== undefined) {
          const observacao = lerObservacao(req.body.observation, antigo.observacoesSaude);
          if (podeVerSaude(req, antigo.clienteId, acessoSaude)) dados.observacoesSaude = observacao;
          // Qualquer texto é recusado, mesmo igual ao gravado: aceitar o igual deixaria confirmar a observação escondida por chute
          else if (observacao !== null) {
            throw new HttpError(403, 'Você não tem acesso à ficha de saúde deste cliente, então não pode alterar as observações. Peça à supervisão ou ao profissional do atendimento.');
          }
        }
        // Remarcado pelo próprio profissional: a nova data não renova o acesso à ficha de saúde
        if (!gerenciaAgenda(req) && inicio.getTime() !== antigo.data.getTime()) dados.reservaOrigem = ORIGEM_COLABORADOR;
        if (req.body.clientName !== undefined || req.body.clientId !== undefined || req.body.clientObservation !== undefined) {
          const cliente = await resolverCliente(tx, req, req.body, { clienteAtualId: antigo.clienteId, acessoSaude, exigirAnamnese });
          if (encerrado && cliente.id !== antigo.clienteId) throw new HttpError(409, 'Atendimento já encerrado: não dá para trocar o cliente.');
          // Só na troca de cliente: atendimentos marcados antes da chave ligada continuam remarcáveis
          if (exigirAnamnese && cliente.id !== antigo.clienteId) await garantirFichaAnamnese(tx, req, cliente, req.body.clientObservation, acessoSaude);
          dados.clienteId = cliente.id;
          // Cliente trocado pelo próprio colaborador não libera a ficha de saúde (ver clientesComAcessoSaude)
          if (cliente.id !== antigo.clienteId && !gerenciaAgenda(req)) dados.reservaOrigem = ORIGEM_COLABORADOR;
        }
        const clienteFinal = typeof dados.clienteId === 'string' ? dados.clienteId : antigo.clienteId;
        if (!encerrado && (inicio.getTime() !== antigo.data.getTime() || !servicosIguais || clienteFinal !== antigo.clienteId)) {
          await conflitoDoCliente(tx, clienteFinal, inicio, duracaoTotal(servicos), id);
        }
        const atualizado = await tx.agendamento.update({ where: { id }, data: dados, include: INCLUDE_COMPLETO });
        // Valor e comissão são dinheiro: toda mudança fica no histórico de alterações (na mesma transação)
        await registrarAuditoria(req, {
          acao: 'agendamento.valores', alvo: alvoDoAtendimento(antigo), tx,
          antes: { valorTotal: antigo.valorTotal, valorComissao: antigo.valorComissao },
          depois: { valorTotal: atualizado.valorTotal, valorComissao: atualizado.valorComissao },
        });
        return atualizado;
      });

      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar agendamento');
    }
  });

  const alterarStatus = async (req: Request, id: string, status: unknown, versaoRecebida: unknown) => {
    if (!(STATUS_AGENDAMENTO as readonly unknown[]).includes(status)) {
      throw new HttpError(400, `Status inválido. Use: ${STATUS_AGENDAMENTO.join(', ')}.`);
    }
    // Do profissional, só o que a resposta pode levar (o registro completo tem hash de senha e e-mail)
    const agendamento = await prisma.agendamento.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
    if (!agendamento) throw new HttpError(404, 'Agendamento não encontrado.');
    garantirPermissao(req, agendamento.colaboradorId);
    const statusAtual = agendamento.status ?? 'scheduled';
    // Pedido repetido (duplo clique) que já chegou ao destino: devolve o registro como está, sem erro
    if (statusAtual === status) return agendamento;
    const versao = exigirVersao(versaoRecebida);
    conferirVersao(agendamento.atualizadoEm, versao);

    const erroTransicao = erroTransicaoStatus(statusAtual, status as string, agendamento.data, usuarioEhSupervisor(req), gerenciaAgenda(req));
    if (erroTransicao) throw new HttpError(409, erroTransicao);

    const reativando = status === 'scheduled';
    if (reativando && agendamento.cliente?.removidoEm) {
      throw new HttpError(409, 'O cadastro deste cliente foi excluído. Para atendê-lo de novo, faça um novo agendamento com os dados dele.');
    }
    if (!reativando) {
      // Grava só se ninguém mudou o registro desde a leitura: concluir e marcar falta ao mesmo tempo não
      // pode terminar com o último vencendo sem passar pela regra de transição
      const { count } = await prisma.agendamento.updateMany({
        where: { id, status: agendamento.status, atualizadoEm: agendamento.atualizadoEm },
        data: { status: status as string },
      });
      const atual = await prisma.agendamento.findUniqueOrThrow({ where: { id }, include: INCLUDE_COMPLETO });
      // Duas requisições iguais em paralelo: a segunda encontra o destino já gravado e não é erro
      if (count === 0 && atual.status !== status) throw new HttpError(409, MENSAGEM_VERSAO_DESATUALIZADA, CODIGO_VERSAO_DESATUALIZADA);
      return atual;
    }
    // Reabrir um registro fechado volta a permitir mudar horário, profissional e serviços (e o faturamento):
    // fica no histórico de alterações. Reativar exige que o horário ainda esteja livre (senão vira overbooking).
    return transacaoComTravas(async (tx) => {
      await travarAgenda(tx, agendamento.colaboradorId);
      await travarAgendamento(tx, id);
      // Relido dentro da transação: disponibilidade e auditoria partem do estado atual
      const atual = await tx.agendamento.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
      if (!atual) throw new HttpError(404, 'Agendamento não encontrado.');
      conferirVersao(atual.atualizadoEm, versao);
      const indisponivel = await validarDisponibilidadeProfissional(tx, atual.colaboradorId, atual.data, atual.servicos, { ignorarAgendamentoId: id });
      if (indisponivel) throw new HttpError(409, `Não é possível reativar: ${indisponivel.erro}`);
      await conflitoDoCliente(tx, atual.clienteId, atual.data, duracaoTotal(atual.servicos), id);
      const reaberto = await tx.agendamento.update({ where: { id }, data: { status: 'scheduled' }, include: INCLUDE_COMPLETO });
      await registrarAuditoria(req, { acao: 'agendamento.reaberto', alvo: alvoDoAtendimento(atual), antes: { status: atual.status }, depois: { status: 'scheduled' }, tx });
      return reaberto;
    });
  };

  router.patch('/agendamentos/:id/status', verificarToken, async (req, res) => {
    try {
      const atualizado = await alterarStatus(req, req.params.id, req.body.status, req.body.version);
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar status do agendamento');
    }
  });

  router.patch('/agendamentos/:id/concluir', verificarToken, async (req, res) => {
    try {
      const atualizado = await alterarStatus(req, req.params.id, 'completed', req.body?.version);
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao concluir agendamento');
    }
  });

  // Check-in da reserva feita no totem: a recepção confirma que o cliente chegou e só então a ficha de saúde
  // fica disponível ao profissional (ver clientesComAcessoSaude)
  router.patch('/agendamentos/:id/checkin', verificarToken, async (req, res) => {
    try {
      if (!gerenciaAgenda(req)) throw new HttpError(403, 'Apenas a recepção ou supervisores podem confirmar a chegada do cliente.');
      const agendamento = await prisma.agendamento.findUnique({ where: { id: req.params.id } });
      if (!agendamento) throw new HttpError(404, 'Agendamento não encontrado.');
      if (agendamento.reservaOrigem !== ORIGEM_TOTEM) throw new HttpError(409, 'Só reservas feitas no totem precisam de check-in.');
      if (agendamento.status !== 'scheduled') throw new HttpError(409, 'Só é possível confirmar a chegada de um atendimento marcado.');
      // Chegada é no dia: confirmar antes liberaria a ficha de saúde de uma reserva que ninguém viu chegar
      if (partesNoFuso(agendamento.data).data !== partesNoFuso(new Date()).data) {
        throw new HttpError(409, 'A chegada só pode ser confirmada no dia do atendimento.');
      }
      const atualizado = await prisma.agendamento.update({
        where: { id: agendamento.id }, data: { reservaOrigem: ORIGEM_TOTEM_CHECKIN }, include: INCLUDE_COMPLETO,
      });
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao confirmar a chegada do cliente');
    }
  });

  // Realocar o atendimento para outro profissional (recepção e supervisores)
  const realocar = async (req: Request, id: string, destinoId: unknown, versao: unknown) => {
    if (!gerenciaAgenda(req)) throw new HttpError(403, 'Apenas a recepção ou supervisores podem realocar atendimentos.');
    if (typeof destinoId !== 'string' || !destinoId) throw new HttpError(400, 'Informe o colaborador de destino.');

    const versaoEsperada = exigirVersao(versao);

    return transacaoComTravas(async (tx) => {
      // Trava do destino antes da linha: a mesma ordem da edição (agenda, depois agendamento), sem impasse entre elas
      await travarAgenda(tx, destinoId);
      await travarAgendamento(tx, id);
      const agendamento = await tx.agendamento.findUnique({ where: { id }, include: { servicos: true } });
      if (!agendamento) throw new HttpError(404, 'Agendamento não encontrado.');
      conferirVersao(agendamento.atualizadoEm, versaoEsperada);
      // Mesma regra da edição: registro fechado não troca de profissional (mudaria o dono do faturamento e da comissão)
      if (statusFechado(agendamento.status)) {
        throw new HttpError(409, 'Atendimento já encerrado (concluído, falta ou cancelado): não dá para mudar o profissional.');
      }
      // Mesmo profissional: nada muda (e a versão não avança, para não derrubar quem está editando em outra aba)
      if (destinoId === agendamento.colaboradorId) return tx.agendamento.findUniqueOrThrow({ where: { id }, include: INCLUDE_COMPLETO });

      const indisponivel = await validarDisponibilidadeProfissional(tx, destinoId, agendamento.data, agendamento.servicos, { ignorarAgendamentoId: id });
      if (indisponivel) throw new HttpError(indisponivel.status, indisponivel.erro);

      return tx.agendamento.update({ where: { id }, data: { colaboradorId: destinoId }, include: INCLUDE_COMPLETO });
    });
  };

  router.patch('/agendamentos/:id/reassign', verificarToken, async (req, res) => {
    try {
      const atualizado = await realocar(req, req.params.id, req.body.newEmployeeId, req.body.version);
      notificar();
      res.json(prepararAgendamento(atualizado, req, await clientesComAcessoSaude(req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao realocar agendamento');
    }
  });

  // Exclusão definitiva (apenas supervisores). Para desmarcar mantendo histórico, use o status "cancelled".
  // Concluído e falta são registro do que aconteceu (faturamento, comissão, faltas): não se apagam, se reabrem.
  router.delete('/agendamentos/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      await prisma.$transaction(async (tx) => {
        const ag = await tx.agendamento.findUnique({
          where: { id }, include: { cliente: { select: { codigo: true } }, colaborador: { select: { nome: true } } },
        });
        if (!ag) throw new HttpError(404, 'Agendamento não encontrado. Ele pode já ter sido excluído.');
        if (ag.status === 'completed' || ag.status === 'no_show') {
          throw new HttpError(409, 'Atendimento concluído ou com falta não pode ser excluído: ele entra no faturamento e nas faltas. Reabra-o antes, se foi registrado por engano.');
        }
        // A tela sempre manda a versão (não apaga um atendimento que alguém acabou de alterar). Scripts e limpezas de
        // teste podem omiti-la: só supervisor exclui, e concluído/falta já são barrados acima
        if (typeof req.body?.version === 'string' && req.body.version) conferirVersao(ag.atualizadoEm, req.body.version);
        const removido = await tx.agendamento.deleteMany({ where: { id, atualizadoEm: ag.atualizadoEm } });
        if (removido.count === 0) throw new HttpError(409, MENSAGEM_VERSAO_DESATUALIZADA, CODIGO_VERSAO_DESATUALIZADA);
        await registrarAuditoria(req, { acao: 'agendamento.excluido', alvo: alvoDoAtendimento(ag), antes: { status: ag.status ?? 'scheduled' }, depois: { status: 'excluído' }, tx });
      });
      notificar();
      res.json({ mensagem: 'Agendamento excluído com sucesso' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir agendamento');
    }
  });

  return router;
}
