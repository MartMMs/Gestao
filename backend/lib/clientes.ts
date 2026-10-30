import { Prisma } from '@prisma/client';
import { travarChave } from './transacao';
import { normalizarNome } from '../../shared/validadores';

// Dois cadastros ativos com o mesmo nome confundem agenda, histórico e ficha de saúde: o sistema não deixa.
// A trava serializa cadastros simultâneos do mesmo nome; a comparação ignora acentos, caixa e espaços.
export const clienteComMesmoNome = async (tx: Prisma.TransactionClient, nome: string, ignorarId?: string) => {
  const normalizado = normalizarNome(nome);
  await travarChave(tx, `cliente-nome:${normalizado}`);
  // Sem pré-filtro no banco: ILIKE não ignora acento ("Ângela" x "Angela"); a comparação é toda em normalizarNome
  const candidatos = await tx.cliente.findMany({
    where: { removidoEm: null, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true, nome: true, codigo: true },
  });
  return candidatos.find((c) => normalizarNome(c.nome) === normalizado) ?? null;
};

export const NOME_CLIENTE_REMOVIDO = 'Cliente removido';

export const mensagemNomeDuplicado = (existente: { nome: string; codigo: number }) =>
  `Já existe um cliente chamado "${existente.nome}" (código #${existente.codigo}). Selecione esse cadastro na busca ou diferencie o nome (por exemplo, com o sobrenome).`;
