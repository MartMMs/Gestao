import { Router } from 'express';
import { prisma } from '../db';
import { verificarSupervisorToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { registrarAuditoria } from '../lib/auditoria';
import { chaveHabilidade, limparNomeHabilidade } from '../services/habilidadeService';

const ERRO_DUPLICADA = 'Já existe uma habilidade com este nome.';

const lerNome = (valor: unknown) => {
  const nome = typeof valor === 'string' ? limparNomeHabilidade(valor) : '';
  if (nome.length < 2 || nome.length > 60) throw new HttpError(400, 'O nome da habilidade deve ter de 2 a 60 caracteres.');
  return nome;
};

// Cadastro de habilidades: só supervisão e admin (recepção e profissionais recebem 403 em todas as rotas)
export function createHabilidadesRouter(notificar: Notificar) {
  const router = Router();

  // ?incluirArquivadas=true traz também as arquivadas; cada uma vem com quantos serviços ativos e profissionais a usam
  router.get('/habilidades', verificarSupervisorToken, async (req, res) => {
    try {
      const habilidades = await prisma.habilidade.findMany({
        where: req.query.incluirArquivadas === 'true' ? {} : { ativa: true },
        orderBy: { nome: 'asc' },
        include: { _count: { select: { servicos: { where: { ativo: true } }, colaboradores: { where: { ativo: true } } } } },
      });
      res.json(habilidades.map(({ _count, nomeNormalizado: _n, ...h }) => ({
        ...h, servicosAtivos: _count.servicos, colaboradores: _count.colaboradores,
      })));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar habilidades');
    }
  });

  router.post('/habilidades', verificarSupervisorToken, async (req, res) => {
    try {
      const nome = lerNome(req.body?.nome);
      if (await prisma.habilidade.findUnique({ where: { nomeNormalizado: chaveHabilidade(nome) } })) {
        return res.status(409).json({ erro: ERRO_DUPLICADA });
      }
      const habilidade = await prisma.habilidade.create({ data: { nome, nomeNormalizado: chaveHabilidade(nome) } });
      await registrarAuditoria(req, { acao: 'habilidade.criada', alvo: `Habilidade ${nome}`, antes: {}, depois: { nome, ativa: true } });
      notificar();
      res.status(201).json(habilidade);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ erro: ERRO_DUPLICADA });
      responderErro(res, error, 'Erro ao criar habilidade');
    }
  });

  // Renomear e/ou reativar (ativa: true). Arquivar tem rota própria, que devolve o impacto
  router.put('/habilidades/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const anterior = await prisma.habilidade.findUnique({ where: { id: req.params.id } });
      if (!anterior) return res.status(404).json({ erro: 'Habilidade não encontrada.' });
      const nome = req.body?.nome === undefined ? anterior.nome : lerNome(req.body.nome);
      if (req.body?.ativa !== undefined && req.body.ativa !== true) {
        return res.status(400).json({ erro: 'Para arquivar, use "Arquivar" (PATCH /habilidades/:id/arquivar).' });
      }
      const ativa = req.body?.ativa === true ? true : anterior.ativa;
      const dona = await prisma.habilidade.findUnique({ where: { nomeNormalizado: chaveHabilidade(nome) } });
      if (dona && dona.id !== anterior.id) return res.status(409).json({ erro: ERRO_DUPLICADA });
      const habilidade = await prisma.habilidade.update({ where: { id: anterior.id }, data: { nome, nomeNormalizado: chaveHabilidade(nome), ativa } });
      await registrarAuditoria(req, {
        acao: ativa && !anterior.ativa ? 'habilidade.reativada' : 'habilidade.alterada', alvo: `Habilidade ${nome}`,
        antes: anterior, depois: habilidade, campos: ['nome', 'ativa'],
      });
      notificar();
      res.json(habilidade);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ erro: ERRO_DUPLICADA });
      responderErro(res, error, 'Erro ao alterar habilidade');
    }
  });

  // Nunca apaga: vínculos e histórico ficam, a habilidade só deixa de valer nas regras. Devolve os serviços ativos afetados
  router.patch('/habilidades/:id/arquivar', verificarSupervisorToken, async (req, res) => {
    try {
      const anterior = await prisma.habilidade.findUnique({
        where: { id: req.params.id },
        include: { servicos: { where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } } },
      });
      if (!anterior) return res.status(404).json({ erro: 'Habilidade não encontrada.' });
      if (anterior.ativa) {
        await prisma.habilidade.update({ where: { id: anterior.id }, data: { ativa: false } });
        await registrarAuditoria(req, { acao: 'habilidade.arquivada', alvo: `Habilidade ${anterior.nome}`, antes: { ativa: true }, depois: { ativa: false } });
        notificar();
      }
      res.json({ id: anterior.id, ativa: false, servicosAfetados: anterior.servicos, totalServicosAfetados: anterior.servicos.length });
    } catch (error) {
      responderErro(res, error, 'Erro ao arquivar habilidade');
    }
  });

  return router;
}
