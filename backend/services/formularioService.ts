import type { Prisma, CampoFormulario as CampoDb } from '@prisma/client';
import { prisma } from '../db';
import { transacaoComTravas, travarChave } from '../lib/transacao';
import type { Request } from 'express';
import { getUsuario } from '../auth';
import { HttpError } from '../lib/http';
import { registrarAuditoria } from '../lib/auditoria';
import { alertasDe, fichaDoAto, montarSnapshot, presetDoSegmento, type CampoFormulario, type TipoCampo, type CanalCampo } from '../../shared/formularioAnamnese';
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

/** Grava, na transação do cadastro/agendamento, a ficha enviada junto (true se gravou). Erro de validação vira 400. */
export const gravarFichaNoAto = async (tx: Prisma.TransactionClient, req: Request, cliente: { id: string; codigo?: number | null }, respostas: unknown) => {
  const { campos, versao } = await lerCampos(tx);
  const ficha = fichaDoAto(campos, respostas, getUsuario(req)?.papel);
  if (!ficha) return false;
  if ('erro' in ficha) throw new HttpError(400, ficha.erro!);
  await tx.fichaPreenchida.create({
    data: {
      clienteId: cliente.id, canal: ficha.canal, versaoFormulario: versao, snapshot: montarSnapshot(ficha.itens, versao, ficha.canalSnapshot),
      alertas: alertasDe(ficha.itens), preenchidoPorId: getUsuario(req)?.id ?? null,
    },
  });
  // Só o fato (sem as respostas): o histórico de alterações não guarda dado de saúde
  await registrarAuditoria(req, { acao: 'cliente.anamnese', alvo: `Cliente #${cliente.codigo ?? ''}`, antes: { fichaFormulario: null }, depois: { fichaFormulario: `versão ${versao}` }, tx });
  return true;
};
