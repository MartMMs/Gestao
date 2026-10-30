import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { clienteComMesmoNome, mensagemNomeDuplicado } from '../lib/clientes';
import { clientesComAcessoSaude, prepararCliente } from '../lib/privacidade';
import { LIMITE_OBSERVACAO, MENSAGEM_CPF_INVALIDO, MENSAGEM_TELEFONE_INVALIDO, apenasDigitos, cpfValido, normalizarTelefone, telefoneValido, valorMascarado } from '../../shared/validadores';

const formatarDataHora = (data: Date) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(data);

export function createClientesRouter(notificar: Notificar) {
  const router = Router();

  router.get('/clientes', verificarToken, async (req, res) => {
    try {
      // Recepção e supervisão veem a carteira toda (agendam para qualquer cliente); o profissional, só os clientes
      // que atende ou já atendeu (minimização de dados da LGPD)
      const clientes = await prisma.cliente.findMany({
        where: {
          removidoEm: null,
          // Mesmo critério do agendamento (resolverCliente): cancelado ou falta não conta como cliente do profissional
          ...(usuarioGerenciaAgenda(req) ? {} : {
            agendamentos: { some: { colaboradorId: getUsuario(req)?.id ?? '', status: { in: ['scheduled', 'completed'] } } },
          }),
        },
        orderBy: { nome: 'asc' },
      });
      if (usuarioEhSupervisor(req)) return res.json(clientes);
      const meus = await clientesComAcessoSaude(req);
      res.json(clientes.map((c) => prepararCliente(c, req, meus.has(c.id))));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar clientes');
    }
  });

  router.put('/clientes/:id', verificarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const cliente = await prisma.cliente.findUnique({ where: { id } });
      if (!cliente || cliente.removidoEm) return res.status(404).json({ erro: 'Cliente não encontrado.' });

      const { nome, telefone, cpf, observacao } = req.body ?? {};
      const dados: Prisma.ClienteUpdateInput = {};

      if (observacao !== undefined) {
        if (observacao !== null && typeof observacao !== 'string') return res.status(400).json({ erro: 'Observação inválida.' });
        if (!usuarioEhSupervisor(req) && !(await clientesComAcessoSaude(req)).has(id)) {
          return res.status(403).json({ erro: 'Você só pode registrar anamnese de clientes que atende.' });
        }
        dados.observacao = observacao ? observacao.slice(0, LIMITE_OBSERVACAO) : null;
      }

      // Dados cadastrais: apenas supervisores. Valores mascarados nunca sobrescrevem o dado real.
      // Nome nunca é mascarado: qualquer valor enviado conta como alteração de cadastro
      const alteraCadastro = nome !== undefined || [telefone, cpf].some((v) => v !== undefined && !valorMascarado(v));
      if (alteraCadastro && !usuarioEhSupervisor(req)) {
        return res.status(403).json({ erro: 'Apenas supervisores podem alterar nome, telefone ou CPF do cliente.' });
      }
      if (nome !== undefined) {
        const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
        if (nomeLimpo.length < 2) return res.status(400).json({ erro: 'O nome do cliente não pode ficar vazio.' });
        if (valorMascarado(nomeLimpo)) return res.status(400).json({ erro: 'O nome do cliente não pode conter "*".' });
        dados.nome = nomeLimpo.slice(0, 120);
      }
      if (telefone !== undefined && !valorMascarado(telefone)) {
        if (telefone && !telefoneValido(telefone)) return res.status(400).json({ erro: MENSAGEM_TELEFONE_INVALIDO });
        dados.telefone = normalizarTelefone(telefone) || null;
      }
      if (cpf !== undefined && !valorMascarado(cpf)) {
        if (cpf && !cpfValido(cpf)) return res.status(400).json({ erro: MENSAGEM_CPF_INVALIDO });
        dados.cpf = apenasDigitos(cpf) || null;
      }

      const atualizado = await prisma.$transaction(async (tx) => {
        if (dados.nome) {
          const homonimo = await clienteComMesmoNome(tx, dados.nome as string, id);
          if (homonimo) throw new HttpError(409, mensagemNomeDuplicado(homonimo));
        }
        return tx.cliente.update({ where: { id }, data: dados });
      });
      notificar();
      res.json(prepararCliente(atualizado, req, true));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar cliente');
    }
  });

  // Exclui o cliente (apenas supervisores). Atendimentos marcados impedem a exclusão. Com histórico, os dados
  // pessoais e de saúde são apagados e os atendimentos ficam (financeiro e comissões); sem histórico, apaga tudo.
  router.delete('/clientes/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const resultado = await prisma.$transaction(async (tx) => {
        const cliente = await tx.cliente.findUnique({ where: { id } });
        if (!cliente || cliente.removidoEm) return { tipo: 'nao_encontrado' as const };

        // Inclui o que está em andamento ou ainda não foi fechado: anonimizar no meio do atendimento apagaria a ficha
        const marcados = await tx.agendamento.findMany({
          where: { clienteId: id, status: 'scheduled' }, orderBy: { data: 'asc' }, take: 5,
          select: { data: true, colaborador: { select: { nome: true } } },
        });
        if (marcados.length > 0) return { tipo: 'com_marcados' as const, marcados };

        const historico = await tx.agendamento.count({ where: { clienteId: id } });
        if (historico === 0) {
          await tx.cliente.delete({ where: { id } });
          return { tipo: 'excluido' as const };
        }
        await tx.agendamento.updateMany({ where: { clienteId: id }, data: { observacoesSaude: null } });
        await tx.cliente.update({
          where: { id },
          data: { nome: 'Cliente removido', telefone: null, cpf: null, observacao: null, removidoEm: new Date() },
        });
        return { tipo: 'anonimizado' as const, historico };
      });

      if (resultado.tipo === 'nao_encontrado') return res.status(404).json({ erro: 'Cliente não encontrado. Ele pode já ter sido excluído.' });
      if (resultado.tipo === 'com_marcados') {
        return res.status(409).json({
          erro: `Este cliente ainda tem atendimento(s) em aberto: ${resultado.marcados
            .map((a) => `${formatarDataHora(a.data)} com ${a.colaborador?.nome ?? 'profissional removido'}`).join('; ')}. `
            + 'Conclua, cancele ou marque falta na agenda antes de excluir o cadastro.',
        });
      }
      notificar();
      res.json({
        mensagem: resultado.tipo === 'excluido'
          ? 'Cliente excluído com sucesso.'
          : `Dados pessoais do cliente apagados. O histórico de ${resultado.historico} atendimento(s) foi mantido sem identificação.`,
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir cliente');
    }
  });

  return router;
}
