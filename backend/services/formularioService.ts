import type { Prisma, CampoFormulario as CampoDb } from '@prisma/client';
import { prisma } from '../db';
import { transacaoComTravas, travarChave } from '../lib/transacao';
import type { Request } from 'express';
import { getUsuario } from '../auth';
import { HttpError } from '../lib/http';
import { registrarAuditoria } from '../lib/auditoria';
import { alertasDe, fichaDoAto, formularioVazio, montarSnapshot, presetDoSegmento, type CampoFormulario, type ItemFicha, type TipoCampo, type CanalCampo } from '../../shared/formularioAnamnese';
import { getEmpresaConfig } from './configService';

// Mesma trava em toda escrita do formulário (editor, preset e a criação inicial)
export const TRAVA_FORMULARIO = 'formulario-anamnese';

type Db = Prisma.TransactionClient | typeof prisma;

export const paraCampo = (c: CampoDb): CampoFormulario => ({
  id: c.id, chave: c.chave, rotulo: c.rotulo, ajuda: c.ajuda, tipo: c.tipo as TipoCampo, opcoes: c.opcoes,
  canal: c.canal as CanalCampo, obrigatorio: c.obrigatorio, dadoSensivel: c.dadoSensivel, respostasAlerta: c.respostasAlerta,
  ordem: c.ordem, ativa: c.ativa, versao: c.versao,
});

/**
 * Campos do formulário, criando na primeira vez os do segmento da empresa (formularioVersao 0 = nunca inicializado).
 * Quem atualiza o sistema sem reconfigurar continua com as mesmas perguntas que o totem já fazia.
 */
export const listarCampos = async (): Promise<{ campos: CampoFormulario[]; versao: number }> => {
  const config = await getEmpresaConfig();
  if (config.formularioVersao === 0) {
    await transacaoComTravas(async (tx) => {
      await travarChave(tx, TRAVA_FORMULARIO);
      const atual = await tx.configuracaoEmpresa.findUnique({ where: { id: 'default' }, select: { formularioVersao: true, segmento: true } });
      if (!atual || atual.formularioVersao !== 0) return;
      await tx.campoFormulario.createMany({
        data: presetDoSegmento(atual.segmento).map((c, ordem) => ({ ...c, ordem, versao: 1 })),
        skipDuplicates: true,
      });
      await tx.configuracaoEmpresa.update({ where: { id: 'default' }, data: { formularioVersao: 1 } });
    });
  }
  return lerCampos(prisma);
};

export const lerCampos = async (db: Db) => {
  const [campos, config] = await Promise.all([
    db.campoFormulario.findMany({ orderBy: [{ ativa: 'desc' }, { ordem: 'asc' }, { criadoEm: 'asc' }] }),
    db.configuracaoEmpresa.findUnique({ where: { id: 'default' }, select: { formularioVersao: true } }),
  ]);
  return { campos: campos.map(paraCampo), versao: config?.formularioVersao ?? 0 };
};

type CanalGravado = 'totem' | 'recepcao' | 'profissional';

/** Única gravação de FichaPreenchida: snapshot imutável e alertas calculados aqui, para todo canal. */
export const criarFicha = (tx: Prisma.TransactionClient, f: {
  clienteId: string; canal: CanalGravado; itens: ItemFicha[]; versao: number;
  autorId?: string | null; agendamentoId?: string; vinculadaAoCliente?: boolean;
}) => tx.fichaPreenchida.create({
  data: {
    clienteId: f.clienteId, canal: f.canal, versaoFormulario: f.versao, agendamentoId: f.agendamentoId, vinculadaAoCliente: f.vinculadaAoCliente,
    // Recepção grava as perguntas do totem/ambos: o snapshot segue as regras de visibilidade do totem
    snapshot: montarSnapshot(f.itens, f.versao, f.canal === 'profissional' ? 'profissional' : 'totem'),
    alertas: alertasDe(f.itens), preenchidoPorId: f.autorId ?? null,
  },
});

/**
 * Grava, na transação do cadastro/agendamento, a ficha enviada junto. 'gravou'; 'sem_ficha' (não veio resposta);
 * 'formulario_vazio' (não veio e o formulário não tem pergunta ativa: não dá para exigir). Erro de validação vira 400.
 */
export const gravarFichaNoAto = async (
  tx: Prisma.TransactionClient, req: Request, cliente: { id: string; codigo?: number | null }, respostas: unknown,
): Promise<'gravou' | 'sem_ficha' | 'formulario_vazio'> => {
  const { campos, versao } = await lerCampos(tx);
  const ficha = fichaDoAto(campos, respostas, getUsuario(req)?.papel);
  if (!ficha) return formularioVazio(campos, versao) ? 'formulario_vazio' : 'sem_ficha';
  if (!ficha.ok) throw new HttpError(400, ficha.erro);
  await criarFicha(tx, { clienteId: cliente.id, canal: ficha.canal, itens: ficha.itens, versao, autorId: getUsuario(req)?.id });
  // Só o fato (sem as respostas): o histórico de alterações não guarda dado de saúde
  await registrarAuditoria(req, { acao: 'cliente.anamnese', alvo: `Cliente #${cliente.codigo ?? ''}`, antes: { fichaFormulario: null }, depois: { fichaFormulario: `versão ${versao}` }, tx });
  return 'gravou';
};
