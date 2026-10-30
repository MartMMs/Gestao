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

/**
 * Registra uma alteração sensível. Falha ao registrar não desfaz a operação (já concluída), mas fica no log.
 * `campos` limita o que é comparado (ex.: só preço e comissão de um serviço).
 * Com `db` (transação), o registro é gravado junto com a alteração e uma falha desfaz as duas.
 */
export const registrarAuditoria = async (
  req: Request,
  acao: string,
  alvo: string,
  antes: Valores,
  depois: Valores,
  campos?: string[],
  db?: ClienteAuditoria,
) => {
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
