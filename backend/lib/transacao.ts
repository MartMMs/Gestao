import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { conflitoDeTransacao } from './http';

// Transação com novas tentativas quando o banco desfaz uma delas por conflito (P2034: serialização ou impasse entre
// travas). Entre uma tentativa e outra, uma espera curta e aleatória: as duas não voltam a colidir no mesmo instante.
const comNovasTentativas = async <T>(
  operacao: (tx: Prisma.TransactionClient) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel,
  tentativas = 8,
): Promise<T> => {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await prisma.$transaction(operacao, { isolationLevel });
    } catch (error) {
      if (!conflitoDeTransacao(error) || tentativa >= tentativas) throw error;
      await new Promise((resolver) => setTimeout(resolver, 10 + Math.random() * 40 * tentativa));
    }
  }
};

// Read committed + travas por chave, em tudo que lê ou grava a agenda. Não misturar com o serializável: nele a foto dos
// dados é tirada no primeiro comando (a própria trava), e o que outra transação gravou durante a espera fica invisível. No serializável, 12 marcações
// simultâneas de clientes novos colidiam (o INSERT do cliente contra a busca de homônimo, que lê a carteira toda) e
// ~1 em 8 falhava com 24. Aqui cada regra depende de uma trava pega ANTES de ler o que ela confere:
// agenda do profissional (travarAgenda), nome do cliente (travarNomeCliente), CPF (cliente-cpf:n), cliente
// (cliente:id), sala (sala:id), linha do agendamento editado (travarAgendamento), escala (escala:...) e troca (troca:...).
// Ordem usual: agenda, linha, cliente do atendimento, nome, CPF, cliente escolhido. Um impasse raro (ex.: dois
// desligamentos cruzados) é desfeito pelo banco e repetido pelas novas tentativas. Regra nova que leia outra coisa precisa da sua trava.
export const transacaoComTravas = <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) =>
  comNovasTentativas(operacao, Prisma.TransactionIsolationLevel.ReadCommitted);

// Trava do Postgres válida até o fim da transação; serializa operações sobre a mesma chave entre instâncias
export const travarChave = async (tx: Prisma.TransactionClient, chave: string) => {
  const digest = crypto.createHash('sha256').update(chave).digest();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${digest.readInt32BE(0)}::integer, ${digest.readInt32BE(4)}::integer)`;
};

// Uma trava por profissional, não por dia: a regra de interjornada (CLT) olha o dia anterior e o seguinte. Escala,
// troca de turno e desligamento pegam a mesma trava, porque também conferem ou mudam a agenda dele.
export const travarAgenda = (tx: Prisma.TransactionClient, colaboradorId: string) => travarChave(tx, `agenda:${colaboradorId}`);

// Trava a linha até o fim da transação: a mudança de status (fora de transação, condicionada à versão) espera e
// então falha pela versão, em vez de gravar no meio de uma edição já validada
export const travarAgendamento = (tx: Prisma.TransactionClient, id: string) =>
  tx.$executeRaw`SELECT 1 FROM "Agendamento" WHERE id = ${id} FOR UPDATE`;
