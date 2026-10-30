import { Router } from 'express';
import { prisma } from '../db';
import { verificarSupervisorToken, verificarToken } from '../auth';
import { responderErro, type Notificar } from '../lib/http';
import { prepararBloqueio } from '../lib/privacidade';
import { MODOS_ELEGIBILIDADE, agendamentosDoDia, normalizarModoElegibilidade } from '../services/agendaService';
import { dataValida, horarioValido, horarioParaMinutos } from '../../shared/agenda';

const listaDeTextos = (valor: unknown): string[] => {
  if (!Array.isArray(valor)) return [];
  return Array.from(new Set(valor.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)));
};

const numeroOuNaN = (valor: unknown) => (valor === '' || valor === null || valor === undefined ? NaN : Number(valor));

const validarServico = (entrada: unknown) => {
  const payload = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const nome = typeof payload?.nome === 'string' ? payload.nome.trim() : '';
  const preco = numeroOuNaN(payload?.preco);
  const duracao = numeroOuNaN(payload?.duracao);
  const icone = typeof payload?.icone === 'string' ? payload.icone.trim() : '';
  const descricao = typeof payload?.descricao === 'string' ? payload.descricao.trim() : '';
  const categoria = typeof payload?.categoria === 'string' ? payload.categoria.trim() : '';
  const tempoHigienizacaoMin = payload?.tempoHigienizacaoMin === undefined || payload?.tempoHigienizacaoMin === ''
    ? 0
    : Number(payload.tempoHigienizacaoMin);
  const comissaoPercentual = payload?.comissaoPercentual === undefined || payload?.comissaoPercentual === null || payload?.comissaoPercentual === ''
    ? null
    : Number(payload.comissaoPercentual);

  if (payload?.modoElegibilidade !== undefined && !(MODOS_ELEGIBILIDADE as readonly unknown[]).includes(payload.modoElegibilidade)) {
    return { erro: 'Modo de elegibilidade inválido.' };
  }
  const modoElegibilidade = normalizarModoElegibilidade(payload?.modoElegibilidade);
  const cargosPermitidos = modoElegibilidade === 'cargo' ? listaDeTextos(payload?.cargosPermitidos) : [];
  const habilidadesPermitidas = modoElegibilidade === 'habilidade' ? listaDeTextos(payload?.habilidadesPermitidas) : [];
  const profissionaisPermitidos = modoElegibilidade === 'profissional' ? listaDeTextos(payload?.profissionaisPermitidos) : [];

  if (nome.length < 3) return { erro: 'O nome do serviço deve ter ao menos 3 caracteres.' };
  if (nome.length > 80) return { erro: 'O nome do serviço deve ter no máximo 80 caracteres.' };
  if (!Number.isFinite(preco) || preco < 0) return { erro: 'Informe um preço válido (número maior ou igual a zero).' };
  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 480 || duracao % 5 !== 0) {
    return { erro: 'A duração deve ser um número inteiro entre 5 e 480 minutos (múltiplos de 5).' };
  }
  if (icone.length > 64) return { erro: 'Ícone inválido para o serviço.' };
  if (descricao.length > 500) return { erro: 'A descrição deve ter no máximo 500 caracteres.' };
  if (!Number.isInteger(tempoHigienizacaoMin) || tempoHigienizacaoMin < 0 || tempoHigienizacaoMin > 120) {
    return { erro: 'O tempo de higienização deve ser um número inteiro entre 0 e 120 minutos.' };
  }
  const ordem = payload?.ordem === undefined || payload?.ordem === '' ? 0 : Number(payload.ordem);
  if (!Number.isInteger(ordem) || ordem < 0 || ordem > 999) return { erro: 'A ordem no catálogo deve ser um número inteiro entre 0 e 999.' };
  if (categoria.length > 60) return { erro: 'A categoria deve ter no máximo 60 caracteres.' };
  if (comissaoPercentual !== null && (!Number.isFinite(comissaoPercentual) || comissaoPercentual < 0 || comissaoPercentual > 100)) {
    return { erro: 'A comissão deve ser um valor entre 0 e 100%.' };
  }
  if (modoElegibilidade === 'cargo' && cargosPermitidos.length === 0) {
    return { erro: 'Selecione ao menos um cargo para serviços com restrição por cargo.' };
  }
  if (modoElegibilidade === 'habilidade' && habilidadesPermitidas.length === 0) {
    return { erro: 'Selecione ao menos uma habilidade para serviços com restrição por habilidade.' };
  }
  if (modoElegibilidade === 'profissional' && profissionaisPermitidos.length === 0) {
    return { erro: 'Selecione ao menos um profissional para serviços exclusivos.' };
  }

  return {
    data: {
      nome, preco, duracao, icone: icone || 'spa', descricao, categoria, tempoHigienizacaoMin, comissaoPercentual, ordem,
      modoElegibilidade, cargosPermitidos, habilidadesPermitidas, profissionaisPermitidos,
    },
  };
};

const MAX_DIAS_BLOQUEIO = 62;

export function createServicosRouter(notificar: Notificar) {
  const router = Router();

  router.get('/servicos', verificarToken, async (_req, res) => {
    try {
      res.json(await prisma.servico.findMany({ orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] }));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar serviços');
    }
  });

  const nomeEmUso = (nome: string, ignorarId?: string) => prisma.servico.findFirst({
    where: { nome: { equals: nome, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
  });

  router.post('/servicos', verificarSupervisorToken, async (req, res) => {
    try {
      const validacao = validarServico(req.body);
      if (!validacao.data) return res.status(400).json({ erro: validacao.erro });
      if (await nomeEmUso(validacao.data.nome)) return res.status(409).json({ erro: 'Já existe um serviço com este nome.' });

      const servico = await prisma.servico.create({ data: validacao.data });
      notificar();
      res.status(201).json(servico);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ erro: 'Já existe um serviço com este nome.' });
      responderErro(res, error, 'Erro ao criar serviço');
    }
  });

  router.put('/servicos/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const validacao = validarServico(req.body);
      if (!validacao.data) return res.status(400).json({ erro: validacao.erro });
      if (!(await prisma.servico.findUnique({ where: { id } }))) return res.status(404).json({ erro: 'Serviço não encontrado.' });
      if (await nomeEmUso(validacao.data.nome, id)) return res.status(409).json({ erro: 'Já existe um serviço com este nome.' });

      const servico = await prisma.servico.update({ where: { id }, data: validacao.data });
      notificar();
      res.json(servico);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ erro: 'Já existe um serviço com este nome.' });
      responderErro(res, error, 'Erro ao atualizar serviço');
    }
  });

  // Tira de linha ou volta a oferecer: o histórico continua apontando para o serviço
  router.patch('/servicos/:id/ativo', verificarSupervisorToken, async (req, res) => {
    try {
      if (typeof req.body?.ativo !== 'boolean') return res.status(400).json({ erro: 'Informe ativo: true ou false.' });
      const atualizado = await prisma.servico.updateMany({ where: { id: req.params.id }, data: { ativo: req.body.ativo } });
      if (atualizado.count === 0) return res.status(404).json({ erro: 'Serviço não encontrado.' });
      notificar();
      res.json({ mensagem: req.body.ativo ? 'Serviço voltou ao catálogo.' : 'Serviço tirado de linha. Ele continua no histórico.' });
    } catch (error) {
      responderErro(res, error, 'Erro ao alterar o serviço');
    }
  });

  router.delete('/servicos/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const emUso = await prisma.agendamento.count({ where: { servicos: { some: { id } } } });
      if (emUso > 0) {
        return res.status(409).json({ erro: `Este serviço já foi usado em ${emUso} atendimento(s) e não pode ser apagado sem perder o histórico. Use "Tirar de linha" para escondê-lo do catálogo.` });
      }
      const removido = await prisma.servico.deleteMany({ where: { id } });
      if (removido.count === 0) return res.status(404).json({ erro: 'Serviço não encontrado.' });
      notificar();
      res.json({ mensagem: 'Serviço excluído' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir serviço');
    }
  });

  // ---- Bloqueios (faltas, intervalos, folgas e férias) ----
  router.get('/bloqueios', verificarToken, async (req, res) => {
    try {
      const bloqueios = await prisma.bloqueio.findMany();
      res.json(bloqueios.map((b) => prepararBloqueio(b, req)));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar bloqueios');
    }
  });

  // Aceita `data` (um dia) ou `datas` (vários dias, gravados todos ou nenhum)
  router.post('/bloqueios', verificarSupervisorToken, async (req, res) => {
    try {
      const { horaInicio, horaFim, colaboradorId } = req.body ?? {};
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
      const datas: unknown[] = Array.isArray(req.body?.datas) ? req.body.datas : [req.body?.data];

      if (datas.length === 0 || datas.length > MAX_DIAS_BLOQUEIO || !datas.every(dataValida)) {
        return res.status(400).json({ erro: `Informe datas válidas (até ${MAX_DIAS_BLOQUEIO} dias por vez).` });
      }
      if (!horarioValido(horaInicio) || !horarioValido(horaFim)) {
        return res.status(400).json({ erro: 'Informe horário de início e fim no formato HH:MM.' });
      }
      if (horarioParaMinutos(horaFim) <= horarioParaMinutos(horaInicio)) {
        return res.status(400).json({ erro: 'O horário final deve ser maior que o inicial.' });
      }
      if (!motivo || motivo.length > 200) return res.status(400).json({ erro: 'Informe o motivo do bloqueio (até 200 caracteres).' });
      if (typeof colaboradorId !== 'string' || !(await prisma.colaborador.findUnique({ where: { id: colaboradorId } }))) {
        return res.status(400).json({ erro: 'Profissional não encontrado.' });
      }

      const unicas = Array.from(new Set(datas as string[]));

      // Não bloqueia dias com atendimentos marcados no intervalo (férias/folga com clientes agendados)
      const inicioMin = horarioParaMinutos(horaInicio);
      const fimMin = horarioParaMinutos(horaFim);
      const comConflito: string[] = [];
      for (const data of unicas) {
        const doDia = await agendamentosDoDia(prisma, data, { colaboradorId });
        if (doDia.some((ag) => ag.inicioMin < fimMin && inicioMin < ag.fimMin)) comConflito.push(data);
      }
      if (comConflito.length > 0) {
        const lista = comConflito.slice(0, 5).map((d) => d.split('-').reverse().join('/')).join(', ');
        return res.status(409).json({
          erro: `Há atendimentos marcados em ${comConflito.length} dia(s) do período (${lista}${comConflito.length > 5 ? '…' : ''}). Realoque-os antes de bloquear.`,
        });
      }
      const criados = await prisma.$transaction(unicas.map((data) => prisma.bloqueio.create({
        data: { data, horaInicio, horaFim, motivo, colaboradorId },
      })));
      notificar();
      res.status(201).json(Array.isArray(req.body?.datas) ? criados : criados[0]);
    } catch (error) {
      responderErro(res, error, 'Erro ao criar bloqueio');
    }
  });

  router.delete('/bloqueios/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const removido = await prisma.bloqueio.deleteMany({ where: { id: req.params.id } });
      if (removido.count === 0) return res.status(404).json({ erro: 'Bloqueio não encontrado.' });
      notificar();
      res.json({ mensagem: 'Bloqueio removido com sucesso' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir bloqueio');
    }
  });

  return router;
}
