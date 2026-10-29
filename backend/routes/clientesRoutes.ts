import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { usuarioEhSupervisor, verificarSupervisorToken, verificarToken } from '../auth';
import { responderErro, type Notificar } from '../lib/http';
import { clientesComAcessoSaude, prepararCliente } from '../lib/privacidade';
import { LIMITE_OBSERVACAO, MENSAGEM_CPF_INVALIDO, MENSAGEM_TELEFONE_INVALIDO, apenasDigitos, cpfValido, normalizarTelefone, telefoneValido, valorMascarado } from '../../shared/validadores';

export function createClientesRouter(notificar: Notificar) {
  const router = Router();

  router.get('/clientes', verificarToken, async (req, res) => {
    try {
      const clientes = await prisma.cliente.findMany({ orderBy: { nome: 'asc' } });
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
      if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });

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

      const atualizado = await prisma.cliente.update({ where: { id }, data: dados });
      notificar();
      res.json(prepararCliente(atualizado, req, true));
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar cliente');
    }
  });

  // Exclui o cliente e o histórico dele de uma vez (tudo ou nada). Apenas supervisores.
  router.delete('/clientes/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const removido = await prisma.$transaction(async (tx) => {
        await tx.agendamento.deleteMany({ where: { clienteId: id } });
        return tx.cliente.deleteMany({ where: { id } });
      });
      if (removido.count === 0) return res.status(404).json({ erro: 'Cliente não encontrado. Ele pode já ter sido excluído.' });
      notificar();
      res.json({ mensagem: 'Cliente excluído com sucesso' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir cliente');
    }
  });

  return router;
}
