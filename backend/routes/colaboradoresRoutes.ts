import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { getUsuario, usuarioEhAdmin, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken, PAPEIS_VALIDOS, type Papel } from '../auth';
import { HttpError, responderErro } from '../lib/http';
import type { Eventos } from '../lib/eventos';
import { transacaoSerializavel, travarChave } from '../lib/transacao';
import { prepararBloqueio } from '../lib/privacidade';
import { INVALIDAR_SESSOES, PAPEIS_ATENDIMENTO, validarSenha } from '../lib/usuarios';
import { validarDisponibilidadeProfissional } from '../services/agendaService';
import { partesNoFuso } from '../../shared/agenda';
import { ESCOPOS } from '../../shared/escopos';
import { normalizarNome } from '../../shared/validadores';

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

// Dois profissionais ativos com o mesmo nome confundem agenda, escala e comissões
const garantirNomeLivre = async (nome: string, ignorarId?: string) => {
  const candidatos = await prisma.colaborador.findMany({
    where: { ativo: true, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { nome: true },
  });
  const igual = candidatos.find((c) => normalizarNome(c.nome) === normalizarNome(nome));
  if (igual) throw new HttpError(409, `Já existe um profissional ativo chamado "${igual.nome}". Diferencie o nome (por exemplo, com o sobrenome).`);
};

// Mesmo limite do formulário; textos maiores são cortados (vão para todas as listagens e para o totem)
const LIMITE_CARGO = 60;
const LIMITE_ESPECIALIDADE = 100;

const TIPOS_ESCALA = ['6x1', '5x2', '5x1', '12x36', 'rotativo'];
const DIAS_TRABALHO_REGEX = /^[0-6](,[0-6]){0,6}$/;
// Limites por campo: carga semanal até 44h (CLT) e no máximo 5 domingos num mês
const LIMITES_NUMERICOS = {
  folgasDomingoNoMes: { min: 0, max: 5, rotulo: 'Folgas aos domingos no mês', faixa: 'entre 0 e 5' },
  cargaHorariaSemanal: { min: 1, max: 44, rotulo: 'Carga horária semanal', faixa: 'entre 1 e 44 horas' },
} as const;

// Campos opcionais de escala/cargo aceitos na criação e na edição. Valor inválido é recusado (400) em vez de
// ignorado: antes o salvamento dizia "sucesso" e o valor digitado se perdia.
const lerCamposEscala = (body: Record<string, unknown>) => {
  const dados: Record<string, unknown> = {};
  if (body.diasTrabalho !== undefined) {
    const dias = typeof body.diasTrabalho === 'string' ? body.diasTrabalho.replace(/\s/g, '') : '';
    const lista = dias.split(',');
    if (!DIAS_TRABALHO_REGEX.test(dias) || new Set(lista).size !== lista.length) {
      throw new HttpError(400, 'Dias de trabalho inválidos. Use números de 0 (domingo) a 6 (sábado), sem repetir, separados por vírgula.');
    }
    dados.diasTrabalho = dias;
  }
  if (typeof body.cargo === 'string') dados.cargo = body.cargo.trim().slice(0, LIMITE_CARGO);
  if (body.tipoEscala !== undefined) {
    if (typeof body.tipoEscala !== 'string' || !TIPOS_ESCALA.includes(body.tipoEscala)) {
      throw new HttpError(400, `Tipo de escala inválido. Use: ${TIPOS_ESCALA.join(', ')}.`);
    }
    dados.tipoEscala = body.tipoEscala;
  }
  if (typeof body.especialidade === 'string') dados.especialidade = body.especialidade.trim().slice(0, LIMITE_ESPECIALIDADE);
  for (const campo of ['folgasDomingoNoMes', 'cargaHorariaSemanal'] as const) {
    if (body[campo] === undefined) continue;
    const limite = LIMITES_NUMERICOS[campo];
    // null, booleanos e textos como " 40", "4e1" ou "0x28" não viram número: só dígitos
    const numero = typeof body[campo] === 'number' || (typeof body[campo] === 'string' && /^\d{1,2}$/.test(body[campo] as string)) ? Number(body[campo]) : NaN;
    if (!Number.isInteger(numero) || numero < limite.min || numero > limite.max) {
      throw new HttpError(400, `${limite.rotulo} deve ser um número inteiro ${limite.faixa}.`);
    }
    dados[campo] = numero;
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
      await garantirNomeLivre(nome);

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
        await garantirNomeLivre(nome, id);
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
   * - atendimentos marcados (inclusive o que está em andamento) são transferidos para reallocateToId quando ele está
   *   livre no horário; os demais são cancelados e listados na resposta;
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
      if (realocarPara && !(await prisma.colaborador.findFirst({ where: { id: realocarPara, ativo: true, papel: { in: PAPEIS_ATENDIMENTO } } }))) {
        return res.status(400).json({ erro: 'Profissional de destino não encontrado.' });
      }

      const resultado = await transacaoSerializavel(async (tx) => {
        const futuros = await tx.agendamento.findMany({
          // Sem filtro de data: o atendimento em andamento (começou antes de agora) também precisa de dono
          where: { colaboradorId: id, status: 'scheduled' },
          include: { servicos: true, cliente: { select: { nome: true } } },
          orderBy: { data: 'asc' },
        });

        let transferidos = 0;
        const canceladosLista: string[] = [];
        for (const ag of futuros) {
          if (realocarPara) {
            await travarChave(tx, `agenda:${realocarPara}:${partesNoFuso(ag.data).data}`);
            const indisponivel = await validarDisponibilidadeProfissional(tx, realocarPara, ag.data, ag.servicos, { ignorarAgendamentoId: ag.id });
            if (!indisponivel) {
              await tx.agendamento.update({ where: { id: ag.id }, data: { colaboradorId: realocarPara } });
              transferidos += 1;
              continue;
            }
          }
          await tx.agendamento.update({ where: { id: ag.id }, data: { status: 'cancelled' } });
          const { data, horario } = partesNoFuso(ag.data);
          canceladosLista.push(`${data.split('-').reverse().join('/')} às ${horario} (${ag.cliente?.nome ?? 'cliente'})`);
        }
        const cancelados = canceladosLista.length;

        const temHistorico = (await tx.agendamento.count({ where: { colaboradorId: id } })) > 0;
        if (temHistorico) {
          await tx.colaborador.update({ where: { id }, data: { ativo: false } });
          return { desativado: true, transferidos, cancelados, canceladosLista };
        }

        await tx.bloqueio.deleteMany({ where: { colaboradorId: id } });
        await tx.escalaOverride.deleteMany({ where: { colaboradorId: id } });
        await tx.solicitacaoTroca.deleteMany({ where: { colaboradorId: id } });
        await tx.colaborador.delete({ where: { id } });
        return { desativado: false, transferidos, cancelados, canceladosLista };
      });

      // Removido ou desativado: sockets abertos dessa pessoa caem na hora
      eventos.encerrarSessoesDoUsuario(id);
      notificar();
      const detalhe = (resultado.transferidos > 0 ? ` ${resultado.transferidos} atendimento(s) transferido(s).` : '')
        + (resultado.cancelados > 0
          ? ` ${resultado.cancelados} atendimento(s) cancelado(s)${realocarPara ? ' porque o profissional de destino não estava livre' : ''}: `
            + `${resultado.canceladosLista.join('; ')}. Avise esses clientes.`
          : '');
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
