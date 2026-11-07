import { Router, Request } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../db';
import { redisService } from '../services/redisService';
import { assinarToken, avisoTentativasSenha, chaveConferenciaSenha, getUsuario, revogarToken, tokenCsrfDaSessao, senhaAtualConfere, usuarioEhAdmin, usuarioEhSupervisor, usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken, PAPEIS_VALIDOS, type Papel } from '../auth';
import { HttpError, responderErro } from '../lib/http';
import { gravarCookieSessao, tokenDaRequisicao } from '../lib/cookies';
import { config } from '../env';
import type { Eventos } from '../lib/eventos';
import { transacaoComTravas, travarAgenda } from '../lib/transacao';
import { prepararBloqueio } from '../lib/privacidade';
import { INVALIDAR_SESSOES, PAPEIS_ATENDIMENTO, validarSenha } from '../lib/usuarios';
import { validarDisponibilidadeProfissional } from '../services/agendaService';
import { partesNoFuso } from '../../shared/agenda';
import { ESCOPOS } from '../../shared/escopos';
import { EMAIL_REGEX, MENSAGEM_USUARIO_INVALIDO, USUARIO_REGEX, normalizarNome } from '../../shared/validadores';

const PAPEIS_PRIVILEGIADOS: Papel[] = ['admin', 'supervisor'];

// Supervisor só gerencia colaboradores e recepção; papéis privilegiados ficam com o admin
const podeAtribuirPapel = (req: Request, papel: Papel) => usuarioEhAdmin(req) || !PAPEIS_PRIVILEGIADOS.includes(papel);

const podeGerenciarConta = (req: Request, alvo: { id: string; papel: string }) =>
  usuarioEhAdmin(req) || !PAPEIS_PRIVILEGIADOS.includes(alvo.papel as Papel) || alvo.id === getUsuario(req)?.id;

// E-mail é opcional: vazio vira null (o índice único aceita vários null, mas não vários '')
const normalizarEmail = (email: unknown) => (typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null);
const normalizarUsuario = (usuario: unknown) => (typeof usuario === 'string' && usuario.trim() ? usuario.trim().toLowerCase() : null);
// Mesma mensagem na checagem e no conflito do índice único (corrida entre dois cadastros)
const USUARIO_EM_USO = 'Este usuário de acesso já está em uso.';
const EMAIL_EM_USO = 'Este e-mail já está em uso por outro colaborador. Altere o e-mail para continuar.';
const SEM_LOGIN = 'Informe o usuário de acesso (ou um e-mail): sem nenhum dos dois a pessoa não consegue entrar.';

const garantirUsuarioLivre = async (usuario: string | null, ignorarId?: string) => {
  if (usuario === null) return;
  if (!USUARIO_REGEX.test(usuario)) throw new HttpError(400, MENSAGEM_USUARIO_INVALIDO);
  const existente = await prisma.colaborador.findFirst({
    where: { usuario, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  });
  if (existente) throw new HttpError(409, USUARIO_EM_USO);
};

// Dois cadastros simultâneos passam pela checagem e o índice único barra o segundo: vira o mesmo 409 da checagem
const traduzirConflito = (error: unknown): unknown => {
  if ((error as { code?: string })?.code !== 'P2002') return error;
  const campos = String((error as { meta?: { target?: unknown } }).meta?.target ?? '');
  if (campos.includes('usuario')) return new HttpError(409, USUARIO_EM_USO);
  if (campos.includes('email')) return new HttpError(409, EMAIL_EM_USO);
  return error;
};

const garantirEmailLivre = async (email: string | null, ignorarId?: string) => {
  if (email === null) return;
  if (!EMAIL_REGEX.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
  const emUso = await prisma.colaborador.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
  });
  if (emUso) throw new HttpError(409, EMAIL_EM_USO);
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
      // Usuário de acesso (login) e "senha provisória pendente" só para quem gerencia contas: para os demais seriam a
      // lista de alvos de quem tenta adivinhar senhas. A própria conta sempre vê os seus
      if (usuarioEhSupervisor(req)) return res.json(equipe);
      const usuarioId = getUsuario(req)?.id;
      const semCredenciais = equipe.map(({ usuario, trocarSenha, ...colega }) => (colega.id === usuarioId ? { ...colega, usuario, trocarSenha } : colega));
      if (usuarioGerenciaAgenda(req)) return res.json(semCredenciais);
      // Para colegas: também sem e-mail/carga horária e com motivo dos afastamentos mascarado
      res.json(semCredenciais.map(({ email, cargaHorariaSemanal, ...colega }) => ({
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
      const usuario = normalizarUsuario(req.body.usuario);
      const papel: Papel = PAPEIS_VALIDOS.includes(req.body.papel) ? req.body.papel : 'collaborator';

      if (nome.length < 3) return res.status(400).json({ erro: 'Informe o nome completo do colaborador.' });
      const erroSenha = validarSenha(req.body.senha);
      if (erroSenha) return res.status(400).json({ erro: erroSenha });
      if (!podeAtribuirPapel(req, papel)) {
        return res.status(403).json({ erro: 'Apenas administradores podem criar supervisores ou administradores.' });
      }
      if (!usuario && !email) return res.status(400).json({ erro: SEM_LOGIN });
      await garantirUsuarioLivre(usuario);
      await garantirEmailLivre(email);
      await garantirNomeLivre(nome);

      const camposEscala = lerCamposEscala(req.body);
      // A tela não pede mais especialidade: sem ela, vale o cargo (a especialidade é o rótulo da lista e do totem)
      const especialidade = (camposEscala.especialidade as string | undefined) || (camposEscala.cargo as string | undefined) || '';
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
          usuario,
          papel,
          senha: await bcrypt.hash(req.body.senha, 10),
          // Senha provisória vista pela supervisão: a pessoa escolhe a dela no primeiro acesso
          trocarSenha: true,
          ativo: true,
        } as Prisma.ColaboradorCreateInput,
      });
      notificar();
      res.status(201).json(novoColaborador);
    } catch (error) {
      responderErro(res, traduzirConflito(error), 'Erro ao criar colaborador');
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
      // A tela só mostra o cargo: a especialidade (rótulo da lista e do totem) acompanha quando era o próprio cargo ou
      // a conta não tinha cargo (contas antigas, cujo formulário mostra a especialidade como cargo). Especialidade
      // diferente, gravada de propósito, fica
      if (dados.cargo !== undefined && dados.especialidade === undefined && (!alvo.cargo || alvo.especialidade === alvo.cargo)) {
        dados.especialidade = dados.cargo;
      }
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
      if (req.body.usuario !== undefined) {
        const usuario = normalizarUsuario(req.body.usuario);
        await garantirUsuarioLivre(usuario, id);
        dados.usuario = usuario;
      }
      const usuarioFinal = dados.usuario !== undefined ? dados.usuario : alvo.usuario;
      const emailFinal = dados.email !== undefined ? dados.email : alvo.email;
      if (!usuarioFinal && !emailFinal) return res.status(400).json({ erro: SEM_LOGIN });
      // Usuário e e-mail são credenciais de login: mudar qualquer um derruba as sessões e, na própria conta, pede a senha
      // E-mail antigo gravado com maiúsculas e reenviado igual não é troca (o e-mail é comparado sem caixa)
      const credencialMudou = (dados.email !== undefined && dados.email !== (alvo.email?.toLowerCase() ?? null))
        || (dados.usuario !== undefined && dados.usuario !== alvo.usuario);
      const propriaConta = alvo.id === getUsuario(req)?.id;
      if (req.body.papel !== undefined && req.body.papel !== alvo.papel) {
        if (!PAPEIS_VALIDOS.includes(req.body.papel)) return res.status(400).json({ erro: 'Papel inválido.' });
        // Rebaixar a si mesmo por engano não tem volta sem outra pessoa (e o último admin sumiria assim)
        if (propriaConta) return res.status(400).json({ erro: 'A sua própria função de acesso não muda por aqui. Peça a um administrador.' });
        if (!podeAtribuirPapel(req, req.body.papel)) {
          return res.status(403).json({ erro: 'Apenas administradores podem promover a supervisor ou administrador.' });
        }
        dados.papel = req.body.papel;
      }
      const rebaixaAdmin = alvo.papel === 'admin' && dados.papel !== undefined && dados.papel !== 'admin';
      if (req.body.senha) {
        // A própria senha tem um caminho só (com auditoria e sessão nova): POST /api/minha-senha
        if (propriaConta) return res.status(400).json({ erro: 'A sua própria senha não muda pelo cadastro da equipe. Peça a outro supervisor ou administrador para redefini-la.' });
        const erroSenha = validarSenha(req.body.senha);
        if (erroSenha) return res.status(400).json({ erro: erroSenha });
        dados.senha = await bcrypt.hash(req.body.senha, 10);
        // Redefinida por outra pessoa: vira provisória e precisa ser trocada pela dona no próximo acesso
        dados.trocarSenha = true;
      }
      if (dados.senha || credencialMudou) {
        // Na própria conta, trocar o e-mail exige a senha atual: um token vazado não basta para tomar a conta
        if (propriaConta) {
          const senhaAtual = typeof req.body.senhaAtual === 'string' ? req.body.senhaAtual : '';
          const conta = await prisma.colaborador.findUnique({ where: { id }, omit: { senha: false } });
          const conferencia = await senhaAtualConfere(id, senhaAtual, conta?.senha);
          if (!conferencia.confere) {
            return res.status(403).json({ erro: `Para trocar o seu próprio e-mail ou usuário de acesso, informe a senha atual correta.${avisoTentativasSenha(conferencia.restantes)}` });
          }
        }
        // Credenciais novas derrubam as sessões abertas com as antigas (inclusive um token vazado)
        Object.assign(dados, INVALIDAR_SESSOES);
      }

      const colaboradorAtualizado = rebaixaAdmin
        // Trava única para rebaixar admin: dois admins rebaixando um ao outro ao mesmo tempo não zeram os admins
        ? await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('colaborador:ultimo-admin'))`;
          // Sem nenhum admin ativo, ninguém mais cria supervisores nem mexe na configuração da empresa
          if (!(await tx.colaborador.count({ where: { papel: 'admin', ativo: true, id: { not: id } } }))) {
            throw new HttpError(400, 'Esta é a única conta de administrador ativa. Promova outra pessoa a administrador antes de mudar esta.');
          }
          return tx.colaborador.update({ where: { id }, data: dados, omit: { versaoToken: false } });
        })
        : await prisma.colaborador.update({ where: { id }, data: dados, omit: { versaoToken: false } });
      if (dados.versaoToken) eventos.encerrarSessoesDoUsuario(id);
      const { versaoToken, ...colaboradorPublico } = colaboradorAtualizado;
      // Própria conta com credencial nova: a sessão desta aba é trocada por uma nova (como em /minha-senha), em vez de
      // cair como "sessão expirada"; a antiga e as das outras abas/aparelhos deixam de valer
      if (propriaConta && dados.versaoToken) {
        const { token: tokenAntigo } = tokenDaRequisicao(req);
        if (tokenAntigo) await revogarToken(tokenAntigo);
        const token = assinarToken({ id, papel: colaboradorAtualizado.papel as Papel }, versaoToken, config.jwtExpiraEmSegundos);
        gravarCookieSessao(res, token);
        notificar();
        return res.json({ ...colaboradorPublico, sessao: { expiraEm: Date.now() + config.jwtExpiraEmSegundos * 1000, csrf: tokenCsrfDaSessao(token) } });
      }
      // Senha provisória nova: os chutes contra a antiga não podem bloquear a pessoa de criar a dela
      if (dados.senha) await redisService.deleteKey(chaveConferenciaSenha(id));
      notificar();
      res.json(colaboradorPublico);
    } catch (error) {
      responderErro(res, traduzirConflito(error), 'Erro ao atualizar colaborador');
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

      const resultado = await transacaoComTravas(async (tx) => {
        // Sem a trava, uma marcação para quem está saindo (ou para o destino) entraria depois da leitura
        await travarAgenda(tx, id);
        if (realocarPara) await travarAgenda(tx, realocarPara);
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
            const indisponivel = await validarDisponibilidadeProfissional(tx, realocarPara, ag.data, ag.servicos, { ignorarAgendamentoId: ag.id });
            if (!indisponivel) {
              // Condicionado: um atendimento que outra pessoa acabou de mover ou fechar fica como ela deixou
              const { count } = await tx.agendamento.updateMany({ where: { id: ag.id, colaboradorId: id, status: 'scheduled' }, data: { colaboradorId: realocarPara } });
              transferidos += count;
              continue;
            }
          }
          const { count } = await tx.agendamento.updateMany({ where: { id: ag.id, colaboradorId: id, status: 'scheduled' }, data: { status: 'cancelled' } });
          if (count === 0) continue;
          const { data, horario } = partesNoFuso(ag.data);
          canceladosLista.push(`${data.split('-').reverse().join('/')} às ${horario} (${ag.cliente?.nome ?? 'cliente'})`);
        }
        const cancelados = canceladosLista.length;

        const temHistorico = (await tx.agendamento.count({ where: { colaboradorId: id } })) > 0;
        if (temHistorico) {
          await tx.colaborador.update({ where: { id }, data: { ativo: false, ...INVALIDAR_SESSOES } });
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
