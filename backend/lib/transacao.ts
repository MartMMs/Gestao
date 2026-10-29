import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '../db';

// Transação serializável com novas tentativas em caso de conflito de serialização (P2034)
export const transacaoSerializavel = async <T>(
  operacao: (tx: Prisma.TransactionClient) => Promise<T>,
  tentativas = 3,
): Promise<T> => {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await prisma.$transaction(operacao, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2034' || tentativa >= tentativas) throw error;
    }
  }
};

// Trava do Postgres válida até o fim da transação; serializa operações sobre a mesma chave entre instâncias
export const travarChave = async (tx: Prisma.TransactionClient, chave: string) => {
  const digest = crypto.createHash('sha256').update(chave).digest();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${digest.readInt32BE(0)}::integer, ${digest.readInt32BE(4)}::integer)`;
};
