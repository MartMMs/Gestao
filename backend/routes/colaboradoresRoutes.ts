import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { getUsuario, usuarioEhAdmin, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken, PAPEIS_VALIDOS, type Papel } from '../auth';
import { HttpError, responderErro } from '../lib/http';
import type { Eventos } from '../lib/eventos';
import { transacaoSerializavel } from '../lib/transacao';
import { prepararBloqueio } from '../lib/privacidade';
import { INVALIDAR_SESSOES, validarSenha } from '../lib/usuarios';
import { validarDisponibilidadeProfissional } from '../services/agendaService';
import { partesNoFuso } from '../../shared/agenda';
import { ESCOPOS } from '../../shared/escopos';

const PAPEIS_PRIVILEGIADOS: Papel[] = ['admin', 'supervisor'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supervisor só gerencia colaboradores e recepção; papéis privilegiados ficam com o admin
const podeAtribuirPapel = (req: Request, papel: Papel) => usuarioEhAdmin(req) || !PAPEIS_PRIVILEGIADOS.includes(papel);

const podeGerenciarConta = (req: Request, alvo: { id: string; papel: string }) =>
  usuarioEhAdmin(req) || !PAPEIS_PRIVILEGIADOS.includes(alvo.papel as Papel) || alvo.id === getUsuario(req)?.id;

const normalizarEmail = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const garantirEmailLivre = async (email: string, ignorarId?: string) => {
  if (!EMAIL_REGEX.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
  const emUso = await prisma.colaborador.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
  });
  if (emUso) throw new HttpError(409, 'Este e-mail já está em uso por outro colaborador. Altere o e-mail para continuar.');
};

// Mesmo limite do formulário; textos maiores são cortados (vão para todas as listagens e para o totem)
const LIMITE_CARGO = 60;
const LIMITE_ESPECIALIDADE = 100;

// Campos opcionais de escala/cargo aceitos na criação e na edição
const lerCamposEscala = (body: Record<string, unknown>) => {
  const dados: Record<string, unknown> = {};
  if (body.diasTrabalho !== undefined) dados.diasTrabalho = String(body.diasTrabalho);
  if (typeof body.cargo === 'string') dados.cargo = body.cargo.trim().slice(0, LIMITE_CARGO);
  if (typeof body.tipoEscala === 'string') dados.tipoEscala = body.tipoEscala;
  if (typeof body.especialidade === 'string') dados.especialidade = body.especialidade.trim().slice(0, LIMITE_ESPECIALIDADE);
  for (const campo of ['folgasDomingoNoMes', 'cargaHorariaSemanal'] as const) {
    const numero = Number(body[campo]);
    if (body[campo] !== undefined && Number.isInteger(numero) && numero >= 0 && numero <= 80) dados[campo] = numero;
  }
  if (body.habilidades !== undefined) {
    dados.habilidades = Array.isArray(body.habilidades)
      ? body.habilidades.filter((h): h is string => typeof h === 'string' && h.trim() !== '').map((h) => h.trim())
      : [];
  }
  return dados;
};

export function createColaboradoresRouter(eventos: Eventos) {
  const router = Router();
  const notificar = () => eventos.notificarMudanca(ESCOPOS.equipe);

  router.get('/colaboradores', verificarToken, async (req, res) => {
    try {
      // Colaboradores desativados (removidos com histórico) não aparecem na equipe
      const equipe = await prisma.colaborador.findMany({ where: { ativo: true }, include: { bloqueios: true }, orderBy: { nome: 'asc' } });
      if (usuarioGerenciaAgenda(req)) return res.json(equipe);
      // Para colegas: sem e-mail/carga horária e com motivo dos afastamentos mascarado
      const usuarioId = getUsuario(req)?.id;
      res.json(equipe.map(({ email, cargaHorariaSemanal, ...colega }) => ({
        ...colega,
        ...(colega.id === usuarioId ? { email, cargaHorariaSemanal } : {}),
        bloqueios: colega.bloqueios.map((b) => prepararBloqueio(b, req)),
      })));
    } catch (error) {
      responderErro(res, error, 'Erro ao buscar colaboradores');
    }
  });

  router.post('/colaboradores', verificarSupervisorToken, async (req, res) => {
    try {
      const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
      const email = normalizarEmail(req.body.email);
      const papel: Papel = PAPEIS_VALIDOS.includes(req.body.papel) ? req.body.papel : 'collaborator';

      if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome completo do colaborador.' });
      const erroSenha = validarSenha(req.body.senha);
      if (erroSenha) return res.status(400).json({ erro: erroSenha });
      if (!podeAtribuirPapel(req, papel)) {
        return res.status(403).json({ erro: 'Apenas administradores podem criar supervisores ou administradores.' });
      }
      await garantirEmailLivre(email);

      const camposEscala = lerCamposEscala(req.body);
      const especialidade = (camposEscala.especialidade as string | undefined) || '';
      const novoColaborador = await prisma.colaborador.create({
        data: {
          tipoEscala: '6x1',
          folgasDomingoNoMes: 2,
          cargaHorariaSemanal: 40,
          diasTrabalho: '1,2,3,4,5,6',
          cargo: especialidade,
          ...camposEscala,
          especialidade,
          nome,
          email,
          papel,
          senha: await bcrypt.hash(req.body.senha, 10),
          ativo: true,
        } as Prisma.ColaboradorCreateInput,
      });
      notificar();
      res.status(201).json(novoColaborador);
    } catch (error) {
      responderErro(res, error, 'Erro ao criar colaborador');
    }
  });

  router.put('/colaboradores/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const alvo = await prisma.colaborador.findUnique({ where: { id } });
      if (!alvo) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
      if (!podeGerenciarConta(req, alvo)) {
        return res.status(403).json({ erro: 'Apenas administradores podem alterar contas de supervisores ou administradores.' });
      }

      const dados: Record<string, unknown> = lerCamposEscala(req.body);
      if (req.body.nome !== undefined) {
        const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
        if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome completo do colaborador.' });
        dados.nome = nome;
      }
      if (req.body.email !== undefined) {
        const email = normalizarEmail(req.body.email);
        await garantirEmailLivre(email, id);
        dados.email = email;
      }
      const emailMudou = dados.email !== undefined && dados.email !== alvo.email;
      if (req.body.papel !== undefined && req.body.papel !== alvo.papel) {
        if (!PAPEIS_VALIDOS.includes(req.body.papel)) return res.status(400).json({ erro: 'Papel inválido.' });
        if (!podeAtribuirPapel(req, req.body.papel)) {
          return res.status(403).json({ erro: 'Apenas administradores podem promover a supervisor ou administrador.' });
        }
        dados.papel = req.body.papel;
      }
      if (req.body.senha) {
        const erroSenha = validarSenha(req.body.senha);
        if (erroSenha) return res.status(400).json({ erro: erroSenha });
        dados.senha = await bcrypt.hash(req.body.senha, 10);
      }
      if (dados.senha || emailMudou) {
        // Na própria conta, trocar credenciais exige a senha atual: um token vazado não basta para tomar a conta
        if (alvo.id === getUsuario(req)?.id) {
          const senhaAtual = typeof req.body.senhaAtual === 'string' ? req.body.senhaAtual : '';
          const conta = await prisma.colaborador.findUnique({ where: { id }, omit: { senha: false } });
          if (!senhaAtual || !conta?.senha || !(await bcrypt.compare(senhaAtual, conta.senha))) {
            return res.status(403).json({ erro: 'Para trocar a sua própria senha ou e-mail, informe a senha atual correta.' });
          }
        }
        // Credenciais novas derrubam as sessões abertas com as antigas (inclusive um token vazado)
        Object.assign(dados, INVALIDAR_SESSOES);
      }

      const colaboradorAtualizado = await prisma.colaborador.update({ where: { id }, data: dados });
      if (dados.versaoToken) eventos.encerrarSessoesDoUsuario(id);
      notificar();
      res.json(colaboradorAtualizado);
    } catch (error) {
      responderErro(res, error, 'Erro ao atualizar colaborador');
    }
  });

  /**
   * Remove um profissional da equipe sem perder histórico:
   * - atendimentos futuros são transferidos (reallocateToId) ou cancelados;
   * - quem já tem atendimentos é apenas desativado (some da equipe e não faz login), preservando o histórico;
   * - quem nunca atendeu é excluído de vez.
   */
  router.delete('/colaboradores/:id', verificarSupervisorToken, async (req, res) => {
    try {
      const { id } = req.params;
      const destino = req.body?.reallocateToId ?? req.query.reallocateTo;
      const realocarPara = typeof destino === 'string' && destino ? destino : null;

      const alvo = await prisma.colaborador.findUnique({ where: { id } });
      if (!alvo) return res.status(404).json({ erro: 'Colaborador não encontrado.' });
      if (!usuarioEhAdmin(req) && PAPEIS_PRIVILEGIADOS.includes(alvo.papel as Papel)) {
        return res.status(403).json({ erro: 'Apenas administradores podem excluir supervisores ou administradores.' });
      }
      if (alvo.id === getUsuario(req)?.id) return res.status(400).json({ erro: 'Você não pode excluir a própria conta.' });
      if (realocarPara === id) return res.status(400).json({ erro: 'Escolha outro profissional para receber os atendimentos.' });
      if (realocarPara && !(await prisma.colaborador.findFirst({ where: { id: realocarPara, ativo: true } }))) {
        return res.status(400).json({ erro: 'Profissional de destino não encontrado.' });
      }

      const resultado = await transacaoSerializavel(async (tx) => {
        const futuros = await tx.agendamento.findMany({
          where: { colaboradorId: id, status: 'scheduled', data: { gte: new Date() } },
          include: { servicos: true },
        });

        for (const ag of futuros) {
          if (realocarPara) {
            const indisponivel = await validarDisponibilidadeProfissional(tx, realocarPara, ag.data, ag.servicos, { ignorarAgendamentoId: ag.id });
            if (indisponivel) {
              const { data, horario } = partesNoFuso(ag.data);
              throw new HttpError(409, `Não foi possível transferir o atendimento de ${data.split('-').reverse().join('/')} às ${horario}: ${indisponivel.erro}`);
            }
            await tx.agendamento.update({ where: { id: ag.id }, data: { colaboradorId: realocarPara } });
          } else {
            await tx.agendamento.update({ where: { id: ag.id }, data: { status: 'cancelled' } });
          }
        }

        const temHistorico = (await tx.agendamento.count({ where: { colaboradorId: id } })) > 0;
        if (temHistorico) {
          await tx.colaborador.update({ where: { id }, data: { ativo: false } });
          return { desativado: true, transferidos: realocarPara ? futuros.length : 0, cancelados: realocarPara ? 0 : futuros.length };
        }

        await tx.bloqueio.deleteMany({ where: { colaboradorId: id } });
        await tx.escalaOverride.deleteMany({ where: { colaboradorId: id } });
        await tx.solicitacaoTroca.deleteMany({ where: { colaboradorId: id } });
        await tx.colaborador.delete({ where: { id } });
        return { desativado: false, transferidos: realocarPara ? futuros.length : 0, cancelados: realocarPara ? 0 : futuros.length };
      });

      // Removido ou desativado: sockets abertos dessa pessoa caem na hora
      eventos.encerrarSessoesDoUsuario(id);
      notificar();
      const detalhe = resultado.transferidos > 0
        ? ` ${resultado.transferidos} atendimento(s) futuro(s) transferido(s).`
        : resultado.cancelados > 0 ? ` ${resultado.cancelados} atendimento(s) futuro(s) cancelado(s).` : '';
      res.json({
        ...resultado,
        mensagem: resultado.desativado
          ? `Colaborador removido da equipe; o histórico de atendimentos foi preservado.${detalhe}`
          : `Colaborador excluído.${detalhe}`,
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao excluir colaborador');
    }
  });

  return router;
}
