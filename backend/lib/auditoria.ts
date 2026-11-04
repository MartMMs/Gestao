import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario } from '../auth';

type Valores = Record<string, unknown>;

// Só os campos que mudaram entram no registro (antes e depois)
const diferencas = (antes: Valores, depois: Valores) => {
  const campos = Object.keys(depois).filter((campo) => JSON.stringify(antes[campo]) !== JSON.stringify(depois[campo]));
  return {
    antes: Object.fromEntries(campos.map((c) => [c, antes[c] ?? null])),
    depois: Object.fromEntries(campos.map((c) => [c, depois[c] ?? null])),
    mudou: campos.length > 0,
  };
};

type ClienteAuditoria = Pick<Prisma.TransactionClient, 'registroAuditoria'>;

export type DadosAuditoria = {
  acao: string;
  alvo: string;
  antes: Valores;
  depois: Valores;
  // Limita o que é comparado (ex.: só preço e comissão de um serviço)
  campos?: string[];
  // Com a transação da alteração, o registro é gravado junto e uma falha desfaz as duas (usar em dinheiro e
  // agendamentos). Sem ela, a alteração já foi gravada: a falha do registro só vai para o log.
  tx?: ClienteAuditoria;
};

/** Registra uma alteração sensível (só os campos que mudaram, com antes e depois). */
export const registrarAuditoria = async (req: Request, { acao, alvo, antes, depois, campos, tx: db }: DadosAuditoria) => {
  const filtrar = (v: Valores) => (campos ? Object.fromEntries(campos.map((c) => [c, v[c]])) : v);
  const delta = diferencas(filtrar(antes), filtrar(depois));
  if (!delta.mudou) return;
  const data = {
    usuarioId: getUsuario(req)?.id ?? null,
    acao,
    alvo,
    antes: delta.antes as Prisma.InputJsonValue,
    depois: delta.depois as Prisma.InputJsonValue,
  };
  if (db) {
    await db.registroAuditoria.create({ data });
    return;
  }
  try {
    await prisma.registroAuditoria.create({ data });
  } catch (error) {
    console.error('[AUDITORIA] Falha ao registrar', acao, alvo, error);
  }
};
