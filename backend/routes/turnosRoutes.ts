import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { verificarSupervisorToken, verificarToken } from '../auth';
import { HttpError, responderErro, type Notificar } from '../lib/http';
import { transacaoComTravas, travarChave } from '../lib/transacao';
import { horarioValido } from '../../shared/agenda';

const LIMITE_NOME = 40;
const MAX_TURNOS = 30;

// Turnos padrão da escala. Qualquer pessoa logada lê (a escala mostra os nomes); só supervisão/admin altera.
export function createTurnosRouter(notificar: Notificar) {
  const router = Router();

  router.get('/turnos', verificarToken, async (_req, res) => {
    try {
      res.json(await prisma.turno.findMany({ orderBy: [{ inicio: 'asc' }, { fim: 'asc' }] }));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar turnos');
    }
  });

  router.post('/turnos', verificarSupervisorToken, async (req, res) => {
    try {
      const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
      const { inicio, fim } = req.body ?? {};
      if (nome.length < 2 || nome.length > LIMITE_NOME) return res.status(400).json({ erro: `Informe o nome do turno (2 a ${LIMITE_NOME} caracteres).` });
      if (!horarioValido(inicio) || !horarioValido(fim)) return res.status(400).json({ erro: 'Informe início e fim no formato HH:MM.' });
      if (inicio === fim) return res.status(400).json({ erro: 'O início e o fim do turno precisam ser diferentes.' });
      // Contagem e criação sob a mesma trava: dois envios simultâneos não passam juntos do limite
      const turno = await transacaoComTravas(async (tx) => {
        await travarChave(tx, 'turnos');
        if (await tx.turno.count() >= MAX_TURNOS) throw new HttpError(400, `Limite de ${MAX_TURNOS} turnos atingido. Exclua um antes de criar outro.`);
        return tx.turno.create({ data: { nome, inicio, fim } });
      });
      notificar();
      res.status(201).json(turno);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ erro: 'Já existe um turno com esse horário.' });
      }
      responderErro(res, error, 'Erro ao criar turno');
    }
  });

  // Dias de escala já gravados guardam o horário (não o turno): excluir o turno não muda a escala de ninguém
  router.delete('/turnos/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const removido = await prisma.turno.deleteMany({ where: { id: req.params.id } });
      if (removido.count === 0) return res.status(404).json({ erro: 'Turno não encontrado.' });
      notificar();
      res.json({ mensagem: 'Turno excluído.' });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir turno');
    }
  });

  return router;
}
