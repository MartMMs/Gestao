import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../env';
import { assinarToken, revogarToken, verificarSupervisorToken, verificarToken, type Papel } from '../auth';
import { redisService } from '../services/redisService';
import { getEmpresaConfig } from '../services/configService';
import { obterFeriadosNacionais } from '../../shared/feriadosBR';
import { responderErro, ipDoCliente } from '../lib/http';
import type { Eventos } from '../lib/eventos';

// Tentativas por janela: por e-mail+IP (quem erra a própria senha), por IP (força bruta de um ponto) e
// por e-mail no total (força bruta distribuída). Travar alguém pelo e-mail exige muitos IPs diferentes.
const MAX_TENTATIVAS_EMAIL_IP = 10;
const MAX_TENTATIVAS_IP = 60;
const MAX_TENTATIVAS_EMAIL = 50;
const JANELA_LOGIN_SEGUNDOS = 15 * 60;
// Hash de uma senha aleatória, usado só para igualar o tempo do login com e-mail inexistente
const HASH_FICTICIO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const CAMPOS_EMPRESA = [
  'nomeEmpresa', 'segmento', 'slogan', 'icone', 'termoAtendimento', 'termoProfissional',
  'termoEspaco', 'termoServico', 'telefoneContato', 'emailContato', 'endereco', 'corTemaPrimaria',
] as const;

const validarConfigEmpresa = (body: Record<string, unknown>) => {
  const dados: Record<string, string | null> = {};
  for (const campo of CAMPOS_EMPRESA) {
    const valor = body[campo];
    if (valor === undefined) continue;
    if (valor !== null && typeof valor !== 'string') return { erro: `Campo ${campo} inválido.` };
    const texto = typeof valor === 'string' ? valor.trim() : null;
    if (texto && texto.length > 200) return { erro: `O campo ${campo} deve ter no máximo 200 caracteres.` };
    dados[campo] = texto || null;
  }
  if (dados.nomeEmpresa === null) return { erro: 'O nome da empresa é obrigatório.' };
  if (dados.segmento === null) delete dados.segmento;
  if (dados.corTemaPrimaria && !/^#[0-9a-fA-F]{6}$/.test(dados.corTemaPrimaria)) {
    return { erro: 'A cor do tema deve estar no formato #RRGGBB.' };
  }
  if (dados.emailContato && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.emailContato)) {
    return { erro: 'Informe um e-mail de contato válido.' };
  }
  return { dados };
};

export function createEmpresaRouter(eventos: Eventos) {
  const router = Router();

  // Login (público). Mensagem única para e-mail ou senha errados, para não revelar quais e-mails existem.
  router.post('/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

      // A tentativa é contada ANTES de conferir a senha (incremento atômico): requisições em paralelo não furam o limite
      const ip = ipDoCliente(req);
      const chaveEmailIp = `ratelimit:login:email-ip:${email}:${ip}`;
      const chaveIp = `ratelimit:login:ip:${ip}`;
      const chaveEmail = `ratelimit:login:email:${email}`;
      const limites = await Promise.all([
        redisService.rateLimit(chaveEmailIp, MAX_TENTATIVAS_EMAIL_IP, JANELA_LOGIN_SEGUNDOS),
        redisService.rateLimit(chaveIp, MAX_TENTATIVAS_IP, JANELA_LOGIN_SEGUNDOS),
        redisService.rateLimit(chaveEmail, MAX_TENTATIVAS_EMAIL, JANELA_LOGIN_SEGUNDOS),
      ]);
      if (limites.some((limite) => !limite.allowed)) {
        return res.status(429).json({ erro: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' });
      }

      const usuario = await prisma.colaborador.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ativo: true },
        omit: { senha: false },
      });

      // Usuário sem senha cadastrada não entra. Sempre roda o bcrypt (com um hash fictício se preciso)
      // para o tempo de resposta não revelar quais e-mails existem.
      const senhaValida = await bcrypt.compare(senha, usuario?.senha || HASH_FICTICIO) && Boolean(usuario?.senha);
      if (!usuario || !senhaValida) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
      // Acertou: zera as tentativas deste e-mail neste aparelho e devolve a tentativa aos contadores gerais
      // (só login errado conta contra o IP e o e-mail; recepções com muitos logins no mesmo IP não são travadas)
      await Promise.all([
        redisService.deleteKey(chaveEmailIp),
        redisService.devolverTentativa(chaveIp),
        redisService.devolverTentativa(chaveEmail),
      ]);

      const { senha: _hash, versaoToken: _versao, ...usuarioPublico } = usuario;
      const token = assinarToken({ id: usuario.id, papel: usuario.papel as Papel }, usuario.versaoToken, config.jwtExpiraEmSegundos);
      res.json({ token, usuario: usuarioPublico });
    } catch (error) {
      responderErro(res, error, 'Erro interno no servidor');
    }
  });

  // Logout: o token deixa de valer imediatamente (mesmo que tenha sido copiado)
  router.post('/logout', async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const jti = token ? await revogarToken(token) : null;
      if (jti) eventos.encerrarSessao(jti);
      res.status(204).end();
    } catch (error) {
      responderErro(res, error, 'Erro ao encerrar a sessão.');
    }
  });

  router.get('/feriados', verificarToken, (req, res) => {
    const anoQuery = Number(req.query.ano);
    const mesQuery = req.query.mes === undefined ? NaN : Number(req.query.mes);
    const ano = Number.isInteger(anoQuery) && anoQuery >= 2000 && anoQuery <= 2100 ? anoQuery : new Date().getFullYear();

    if (req.query.mes !== undefined && (!Number.isInteger(mesQuery) || mesQuery < 1 || mesQuery > 12)) {
      return res.status(400).json({ erro: 'Parâmetro mês inválido. Use valores entre 1 e 12.' });
    }

    const feriados = obterFeriadosNacionais(ano);
    if (Number.isInteger(mesQuery)) {
      const prefixo = `${ano}-${String(mesQuery).padStart(2, '0')}`;
      return res.json(feriados.filter((f) => f.data.startsWith(prefixo)));
    }
    res.json(feriados);
  });

  // Configurações gerais da empresa (leitura pública: usadas na tela de login e no totem)
  router.get('/empresa/config', async (_req, res) => {
    try {
      res.json(await getEmpresaConfig());
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar configurações da empresa');
    }
  });

  router.put('/empresa/config', verificarSupervisorToken, async (req, res) => {
    try {
      const validacao = validarConfigEmpresa(req.body || {});
      if (!validacao.dados) return res.status(400).json({ erro: validacao.erro });

      await getEmpresaConfig();
      const configAtualizada = await prisma.configuracaoEmpresa.update({
        where: { id: 'default' },
        data: validacao.dados as Record<string, string>,
      });

      eventos.emitirConfigEmpresa(configAtualizada);
      eventos.notificarMudanca();
      res.json(configAtualizada);
    } catch (error) {
      responderErro(res, error, 'Falha ao salvar configurações da empresa');
    }
  });

  return router;
}
