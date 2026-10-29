import { HttpError } from '../lib/http';
import type { DbOuTransacao as Db } from './agendaService';
import { normalizarNome } from '../../shared/validadores';

const textosUnicos = (valores: unknown): string[] => Array.from(new Set((Array.isArray(valores) ? valores : [])
  .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
  .map((v) => v.trim())));

// Agenda interna: o front envia os nomes dos serviços (sem diferenciar maiúsculas)
export const buscarServicosPorNome = async (db: Db, nomes: unknown) => {
  const lista = textosUnicos(nomes);
  if (lista.length === 0) throw new HttpError(400, 'Selecione ao menos um serviço.');

  const servicos = await db.servico.findMany({ where: { nome: { in: lista, mode: 'insensitive' } } });
  const encontrados = new Set(servicos.map((s) => normalizarNome(s.nome)));
  const faltando = lista.filter((n) => !encontrados.has(normalizarNome(n)));
  if (faltando.length > 0) throw new HttpError(400, `Serviço não encontrado: ${faltando.join(', ')}.`);
  return servicos;
};

// Totem: o catálogo público trabalha com IDs; serviço removido no meio do fluxo vira 404
export const buscarServicosPorId = async (db: Db, ids: string[]) => {
  if (ids.length === 0) throw new HttpError(400, 'Selecione ao menos um serviço.');
  const servicos = await db.servico.findMany({ where: { id: { in: ids } } });
  if (servicos.length !== ids.length) throw new HttpError(404, 'Algum dos serviços escolhidos não está mais disponível.');
  return servicos;
};
