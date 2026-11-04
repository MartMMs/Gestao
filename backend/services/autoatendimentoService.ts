import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { HttpError } from '../lib/http';
import { transacaoComTravas, travarAgenda, travarChave } from '../lib/transacao';
import { redisService } from './redisService';
import {
  blocosDoIntervalo,
  chaveTravaProfissional,
  chaveTravaSala,
  validarDisponibilidadeProfissional,
  verificarConflitoSala,
} from './agendaService';
import { DURACAO_PADRAO_MIN, duracaoTotal, instanteNoFuso } from '../../shared/agenda';
import { versaoConsentimentoValida } from '../../shared/consentimento';
import {
  LIMITE_OBSERVACAO,
  MENSAGEM_CPF_INVALIDO,
  MENSAGEM_TELEFONE_INVALIDO,
  apenasDigitos,
  cpfValido,
  normalizarNome,
  semSufixoDoTotem,
  normalizarTelefone,
  telefoneValido,
  variantesTelefone,
} from '../../shared/validadores';

// Regras de negócio do totem (reserva, confirmação e configuração), separadas das rotas HTTP

import { PAPEIS_ATENDIMENTO } from '../lib/usuarios';
import { NOME_CLIENTE_REMOVIDO, clienteComMesmoNome, travarNomeCliente } from '../lib/clientes';
import { comissaoProporcional, valorDosServicos } from '../lib/valores';
import { ORIGEM_TOTEM } from '../lib/privacidade';

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
    valorTotal: valorDosServicos(servicos),
  };
};

// consentimentoEm/consentimentoVersao: só lerClienteTotem preenche, depois de conferir a autorização do cliente
export type ClienteTotem = {
  nome: string; telefone: string; cpf: string | null; observacoesSaude: string;
  consentimentoEm: Date; consentimentoVersao: string;
};

// A tela atual não deixa enviar sem a caixa marcada: quem chega aqui é um totem aberto desde antes da caixa existir
export const MENSAGEM_CONSENTIMENTO_AUSENTE = 'Esta tela está desatualizada. Recarregue a página do totem e marque a autorização de uso dos dados para concluir a reserva.';

// Valida os dados do cliente digitados no totem
export const lerClienteTotem = (entrada: unknown): ClienteTotem => {
  const cliente = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const nome = typeof cliente.nome === 'string' ? cliente.nome.replace(/\s+/g, ' ').trim() : '';
  const telefone = normalizarTelefone(cliente.telefone);
  const cpf = cliente.cpf ? apenasDigitos(cliente.cpf) : '';
  const observacoesSaude = typeof cliente.observacoesSaude === 'string' ? cliente.observacoesSaude.trim() : '';

  if (nome.length < 3 || nome.length > 120) throw new HttpError(400, 'Informe seu nome completo (3 a 120 caracteres).');
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(nome)) throw new HttpError(400, 'O nome deve conter apenas letras.');
  if (normalizarNome(nome) === normalizarNome(NOME_CLIENTE_REMOVIDO)) throw new HttpError(400, 'Informe o seu nome completo.');
  if (!telefoneValido(telefone)) throw new HttpError(400, MENSAGEM_TELEFONE_INVALIDO);
  if (cpf && !cpfValido(cpf)) throw new HttpError(400, `${MENSAGEM_CPF_INVALIDO} Ou deixe o campo em branco.`);
  if (observacoesSaude.length > LIMITE_OBSERVACAO) throw new HttpError(400, `As observações de saúde devem ter no máximo ${LIMITE_OBSERVACAO} caracteres.`);
  // Dado de saúde só com consentimento específico e registrado (LGPD art. 11): sem ele, ou com versão desconhecida, a reserva não é criada
  const versao = cliente.consentimentoVersao;
  if (cliente.consentimento !== true || !versaoConsentimentoValida(versao)) {
    throw new HttpError(400, MENSAGEM_CONSENTIMENTO_AUSENTE);
  }
  return { nome, telefone, cpf: cpf || null, observacoesSaude, consentimentoEm: new Date(), consentimentoVersao: versao };
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
  // Preenchidos pelo gateway de pagamento, quando houver integração (ver configService.gatewayPagamento)
  pixCopiaECola?: string;
  pixQrCode?: string;
  cartaoOnlineDisponivel?: boolean;
};

type SessaoReserva = Pick<SessaoReservaTotem, 'servicoIds' | 'data' | 'horario' | 'terapeutaId' | 'salaId' | 'valorTotal'>;

/**
 * Cria o agendamento de uma reserva do totem, revalidando o horário no banco (a recepção pode ter usado
 * o horário enquanto o cliente preenchia os dados).
 *
 * Cadastro existente é reaproveitado quando nome e telefone conferem (e o CPF também, se os dois lados o têm).
 * Quem está no totem não provou ser o dono do cadastro: por isso nada da ficha é mostrado, nenhuma resposta
 * revela agenda dele, a anamnese digitada não entra na ficha de um cadastro existente (só no agendamento; num
 * cadastro novo vai também para a ficha) e a ficha só abre após o check-in na recepção.
 */
export const criarAgendamentoTotem = async (
  sessao: SessaoReserva,
  cliente: ClienteTotem,
  opcoes: { sessionToken: string; cobranca: Cobranca; metodoPagamento: string },
) => {
  const servicos = await prisma.servico.findMany({ where: { id: { in: sessao.servicoIds }, ativo: true } });
  if (servicos.length !== sessao.servicoIds.length) throw new HttpError(409, 'Um dos serviços escolhidos saiu do catálogo. Escolha os serviços novamente.');
  const inicio = instanteNoFuso(sessao.data, sessao.horario);
  const observacao = cliente.observacoesSaude ? `[Anamnese Autoatendimento ${sessao.data}]: ${cliente.observacoesSaude}` : null;

  return transacaoComTravas(async (tx) => {
    await travarAgenda(tx, sessao.terapeutaId);
    // Sala só é ocupada pelo totem: a trava dela serializa duas reservas de profissionais diferentes na mesma sala
    await travarChave(tx, `sala:${sessao.salaId}`);

    const indisponivel = await validarDisponibilidadeProfissional(tx, sessao.terapeutaId, inicio, servicos, { sessaoPropria: opcoes.sessionToken });
    if (indisponivel) throw new HttpError(409, 'Este horário acabou de ser ocupado. Por favor, escolha outro horário.');
    if (await verificarConflitoSala(tx, sessao.salaId, inicio, duracaoTotal(servicos), opcoes.sessionToken)) {
      throw new HttpError(409, 'A sala deste horário acabou de ser ocupada. Por favor, escolha outro horário.');
    }

    // O totem limita reservas por dispositivo/IP (em /reservar-slot), nunca pelo telefone digitado: sem código por SMS,
    // qualquer limite por telefone revelaria quantas reservas o número tem e permitiria travar o telefone de outra pessoa.
    // Cliente que volta é reconhecida por nome + telefone, e pelo CPF quando os dois lados o têm. Nada é recusado
    // (homônimo com outro telefone, CPF divergente): a recusa revelaria se o nome ou o CPF já estão cadastrados.
    // Quem não confere ganha um cadastro à parte, com sufixo interno, para não ligar a reserva (e, no check-in, a
    // ficha) à pessoa errada nem quebrar a unicidade de nomes; a recepção unifica se for a mesma pessoa.
    // O sufixo leva só os 2 últimos dígitos do telefone, o mesmo que a máscara de privacidade mostra.
    const base = cliente.nome.slice(0, 95).trimEnd();
    const nomesAceitos = [normalizarNome(cliente.nome), normalizarNome(base)];
    // Antes da busca por telefone: o mesmo envio repetido (duas abas, nova tentativa) acha o cadastro do primeiro
    for (const n of [...new Set(nomesAceitos)].sort()) await travarNomeCliente(tx, n);
    const nomeBase = (n: string) => normalizarNome(semSufixoDoTotem(n));
    const mesmoCpf = (c: { cpf: string | null }) => !!c.cpf && !!cliente.cpf && apenasDigitos(c.cpf) === cliente.cpf;
    const candidatos = (await tx.cliente.findMany({ where: { removidoEm: null, telefone: { in: variantesTelefone(cliente.telefone) } } }))
      .filter((c) => nomesAceitos.includes(nomeBase(c.nome)) && (!c.cpf || !cliente.cpf || mesmoCpf(c)));
    // Mais de um (o original e um à parte): primeiro o do mesmo CPF, depois o de nome sem sufixo
    let existente: (typeof candidatos)[number] | undefined = candidatos.find(mesmoCpf) ?? candidatos.find((c) => normalizarNome(c.nome) === nomesAceitos[0]) ?? candidatos[0];
    if (existente) {
      // A exclusão trava o nome com sufixo, não o nome digitado: a trava do cadastro garante que ele ainda está ativo
      await travarChave(tx, `cliente:${existente.id}`);
      if (!(await tx.cliente.findFirst({ where: { id: existente.id, removidoEm: null }, select: { id: true } }))) existente = undefined;
    }
    // Uma leitura só da carteira, feita sempre: com um laço consulta-por-nome, uma cadeia longa de homônimos
    // ("... 2", "... 3", ...) seguraria a agenda do profissional, e o tempo de resposta diria se o nome já é cliente
    const ocupados = new Set((await tx.cliente.findMany({ where: { removidoEm: null }, select: { nome: true } })).map((c) => normalizarNome(c.nome)));
    let nomeCadastro = cliente.nome;
    if (!existente) {
      const sufixoBase = `${base} (tel. final ${cliente.telefone.slice(-2)})`;
      for (let tentativa = 1; ocupados.has(normalizarNome(nomeCadastro)); tentativa += 1) {
        nomeCadastro = tentativa === 1 ? sufixoBase : `${sufixoBase} ${tentativa}`;
      }
      // Só o totem gera nomes com sufixo, e sob a trava do nome-base: aqui o nome escolhido ainda está livre, salvo
      // alguém digitar o mesmo sufixo na recepção neste instante
      if (await clienteComMesmoNome(tx, nomeCadastro)) throw new HttpError(409, 'Não foi possível concluir a reserva agora. Tente confirmar de novo.');
    } else {
      // Mesma quantidade de leituras nos dois caminhos: o tempo de resposta não diz se nome e telefone já são cliente.
      // Sem trava (só a leitura): travar o nome aqui, depois de cliente:id, inverteria a ordem da exclusão
      await tx.cliente.findMany({ where: { removidoEm: null }, select: { id: true, nome: true } });
    }
    const dbCliente = existente
      ?? await tx.cliente.create({ data: { nome: nomeCadastro, telefone: cliente.telefone, cpf: cliente.cpf, observacao } });
    // De propósito, o totem NÃO recusa horário sobreposto de cliente que já existe (a agenda interna recusa): qualquer
    // recusa, mesmo com a mensagem de horário ocupado, diria a quem sabe nome e telefone de alguém que essa pessoa
    // tem atendimento naquela hora. A sobreposição aparece na agenda e a recepção resolve no check-in.

    return tx.agendamento.create({
      data: {
        data: inicio,
        status: 'scheduled',
        colaboradorId: sessao.terapeutaId,
        clienteId: dbCliente.id,
        salaId: sessao.salaId,
        valorTotal: sessao.valorTotal,
        // Proporcional ao valor da reserva (o preço de quando o cliente escolheu), mesma regra da agenda interna
        valorComissao: comissaoProporcional(sessao.valorTotal, servicos),
        valorSinal: opcoes.cobranca.valorACobrar,
        statusPagamento: opcoes.cobranca.statusPagamento,
        // Sem confirmação do gateway até este prazo, a limpeza automática cancela e libera o horário
        lockExpiresAt: opcoes.cobranca.comPagamentoOnline ? new Date(Date.now() + PRAZO_PAGAMENTO_MINUTOS * 60_000) : null,
        metodoPagamento: opcoes.cobranca.comPagamentoOnline ? opcoes.metodoPagamento : 'presencial_no_local',
        reservaToken: opcoes.sessionToken,
        reservaOrigem: ORIGEM_TOTEM,
        consentimentoDadosEm: cliente.consentimentoEm,
        consentimentoVersao: cliente.consentimentoVersao,
        observacoesSaude: cliente.observacoesSaude || null,
        servicos: { connect: servicos.map((s) => ({ id: s.id })) },
      } satisfies Prisma.AgendamentoUncheckedCreateInput,
    });
  });
};
