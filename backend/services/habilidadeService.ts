import type { DbOuTransacao } from './agendaService';
import { HttpError } from '../lib/http';

// "Drenagem  Linfática " e "drenagem linfática" são a mesma habilidade (mesma regra da migration 20261121120000_habilidades)
export const limparNomeHabilidade = (nome: string) => nome.trim().replace(/\s+/g, ' ');
export const chaveHabilidade = (nome: string) => limparNomeHabilidade(nome).toLowerCase();

type ComHabilidades = { habilidadesExigidas?: { id: string; nome: string; ativa: boolean }[] };
type ColabComHabilidades = { habilidadesCadastradas?: { id: string; nome: string; ativa: boolean }[] };

export const SELECT_HABILIDADE = { select: { id: true, nome: true, ativa: true }, orderBy: { nome: 'asc' as const } };

// Resposta de serviço: ids e nomes das habilidades ATIVAS exigidas; as colunas de texto antigas não saem mais
export const servicoParaResposta = <S extends ComHabilidades & { habilidadesPermitidasLegado?: string[] }>(servico: S) => {
  const { habilidadesPermitidasLegado: _legado, habilidadesExigidas = [], ...resto } = servico;
  const ativas = habilidadesExigidas.filter((h) => h.ativa);
  return { ...resto, habilidadeIds: ativas.map((h) => h.id), habilidadesPermitidas: ativas.map((h) => h.nome) };
};

export const colaboradorComHabilidades = <C extends ColabComHabilidades & { habilidadesLegado?: string[] }>(colab: C) => {
  const { habilidadesLegado: _legado, habilidadesCadastradas = [], ...resto } = colab;
  const ativas = habilidadesCadastradas.filter((h) => h.ativa);
  return { ...resto, habilidadeIds: ativas.map((h) => h.id), habilidades: ativas.map((h) => h.nome) };
};

// Ids recebidos do front: precisam existir e estar ativos (os que já estavam vinculados continuam aceitos, mesmo arquivados)
export const validarHabilidadeIds = async (db: DbOuTransacao, valor: unknown, jaVinculados: string[] = []) => {
  if (valor === undefined) return undefined;
  if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) throw new HttpError(400, 'habilidadeIds deve ser uma lista de ids.');
  const ids = Array.from(new Set(valor as string[]));
  if (ids.length > 50) throw new HttpError(400, 'Selecione no máximo 50 habilidades.');
  const encontradas = await db.habilidade.findMany({ where: { id: { in: ids } }, select: { id: true, ativa: true } });
  const validas = new Set(encontradas.filter((h) => h.ativa || jaVinculados.includes(h.id)).map((h) => h.id));
  if (ids.some((id) => !validas.has(id))) throw new HttpError(400, 'Alguma habilidade escolhida não existe ou está arquivada.');
  return ids;
};
