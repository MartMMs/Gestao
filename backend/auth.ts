import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from './db';
import { redisService } from './services/redisService';
import { CABECALHO_CSRF, METODOS_SEGUROS, tokenDaRequisicao } from './lib/cookies';
import { HttpError } from './lib/http';
import { CODIGO_CSRF, CODIGO_TROCAR_SENHA } from '../shared/codigosErro';

import type { Papel } from './lib/usuarios';

export { PAPEIS_VALIDOS, type Papel } from './lib/usuarios';
export type UsuarioToken = { id: string; papel: Papel };

// Chaves que já estiveram publicadas no código e nunca podem ser usadas
const SEGREDOS_PROIBIDOS = new Set(['minha_chave_secreta_super_segura', 'ci-somente-teste-0123456789abcdef0123456789abcdef']);

// Lido sob demanda: o .env é carregado por env.ts antes dos demais módulos do servidor
export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ausente ou curto demais (mínimo 32 caracteres). Defina-o no .env.');
  }
  if (SEGREDOS_PROIBIDOS.has(secret)) {
    throw new Error('JWT_SECRET usa uma chave que já foi publicada. Gere outra com: openssl rand -hex 32');
  }
  return secret;
};

// Cada token tem um id (jti) para ser revogado no logout e carrega a versão das credenciais do usuário (v)
export const assinarToken = (usuario: UsuarioToken, versaoToken: number, expiresIn: jwt.SignOptions['expiresIn']) =>
  jwt.sign({ ...usuario, v: versaoToken }, getJwtSecret(), { algorithm: 'HS256', expiresIn, jwtid: crypto.randomUUID() });

const chaveRevogado = (jti: string) => `token:revogado:${jti}`;

// Conteúdo de um token emitido por assinarToken
type PayloadToken = UsuarioToken & jwt.JwtPayload & { v?: number };

// Assinatura e validade conferidas; null para token inválido ou expirado
const decodificarToken = (token: string): PayloadToken | null => {
  try {
    return jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as PayloadToken;
  } catch {
    return null;
  }
};

type RequestAutenticado = Request & { user?: UsuarioToken };

/**
 * Token anti-CSRF da sessão: HMAC do id do JWT com o segredo do servidor. Muda a cada login, não precisa ser
 * guardado e não serve para outra sessão. Um site de fora não consegue lê-lo (CORS), então não forja a escrita
 * mesmo que o navegador mande o cookie junto.
 */
export const tokenCsrfDaSessao = (token: string): string | null => {
  const payload = decodificarToken(token);
  return payload?.jti ? crypto.createHmac('sha256', getJwtSecret()).update(`csrf:${payload.jti}`).digest('base64url') : null;
};

// Escrita autenticada por cookie sem o token anti-CSRF certo é recusada (Bearer não precisa: não vai sozinho)
export const violaCsrf = (req: Request, token: string | null, viaCookie: boolean) => {
  if (!viaCookie || METODOS_SEGUROS.has(req.method)) return false;
  const esperado = token ? tokenCsrfDaSessao(token) : null;
  const recebido = req.headers[CABECALHO_CSRF];
  if (!esperado || typeof recebido !== 'string') return true;
  // Comparação em bytes: um caractere acentuado tem 2 bytes, e timingSafeEqual lança erro com tamanhos diferentes
  const bytesRecebidos = Buffer.from(recebido);
  const bytesEsperados = Buffer.from(esperado);
  return bytesRecebidos.length !== bytesEsperados.length || !crypto.timingSafeEqual(bytesRecebidos, bytesEsperados);
};

// Identificação e validade de um token já conferido (usado para encerrar sockets na hora certa)
export const dadosDoToken = (token: string) => {
  const payload = decodificarToken(token);
  return payload ? { jti: payload.jti, exp: payload.exp, usuarioId: payload.id } : null;
};

// Revoga o token até a validade original dele (depois disso ele já seria recusado de qualquer forma)
// Retorna o jti revogado (para derrubar também os sockets dessa sessão)
export const revogarToken = async (token: string): Promise<string | null> => {
  const payload = decodificarToken(token);
  // Token já inválido ou expirado: nada a revogar
  if (!payload?.jti || !payload.exp) return null;
  const restante = Math.max(1, payload.exp - Math.floor(Date.now() / 1000));
  await redisService.set(chaveRevogado(payload.jti), '1', restante);
  return payload.jti;
};

export const getUsuario = (req: Request): UsuarioToken | undefined => (req as RequestAutenticado).user;

export const usuarioEhSupervisor = (req: Request) => {
  const papel = getUsuario(req)?.papel;
  return papel === 'supervisor' || papel === 'admin';
};

export const usuarioEhAdmin = (req: Request) => getUsuario(req)?.papel === 'admin';

// Supervisores, admins e recepção gerenciam a agenda de todos os profissionais
export const usuarioGerenciaAgenda = (req: Request) => usuarioEhSupervisor(req) || getUsuario(req)?.papel === 'receptionist';

// Valida o token e confere no banco se o usuário continua ativo; o papel vem do banco (não do token),
// então desativar ou rebaixar alguém vale imediatamente. Trocar senha/e-mail muda a versão e derruba tokens antigos.
// Retorna null para token inválido, revogado, de versão antiga ou de usuário inativo.
export const validarSessao = async (token: string): Promise<(UsuarioToken & { trocarSenha: boolean }) | null> => {
  const payload = decodificarToken(token);
  if (!payload) return null;
  if (payload.jti && await redisService.get(chaveRevogado(payload.jti))) return null;
  const usuario = await prisma.colaborador.findUnique({ where: { id: payload.id }, select: { ativo: true, papel: true, versaoToken: true, trocarSenha: true } });
  if (!usuario?.ativo || payload.v !== usuario.versaoToken) return null;
  return { id: payload.id, papel: usuario.papel as Papel, trocarSenha: usuario.trocarSenha };
};

// Texto que acompanha o "senha incorreta": quantas faltam, ou que acabou de bloquear
export const avisoTentativasSenha = (restantes: number) => (restantes > 0
  ? ` Restam ${restantes} tentativa(s) antes de bloquear por até 15 minutos.`
  : ' A conferência da senha foi bloqueada por até 15 minutos; se precisar agora, peça à supervisão uma senha nova.');
export const chaveConferenciaSenha = (usuarioId: string) => `seguranca:senha-atual:${usuarioId}`;
// Confere a senha atual de quem troca a própria senha ou e-mail. Até 5 conferências em 15 min por conta: uma sessão
// aberta e esquecida (computador da recepção) não vira banco de chutes da senha da dona
export const senhaAtualConfere = async (usuarioId: string, senhaAtual: string, hash: string | null | undefined) => {
  const chave = chaveConferenciaSenha(usuarioId);
  const { allowed, remaining } = await redisService.rateLimit(chave, 5, 15 * 60);
  if (!allowed) throw new HttpError(429, 'Muitas tentativas com a senha. Espere até 15 minutos e tente de novo, ou peça à supervisão uma senha nova.');
  const confere = !!senhaAtual && !!hash && await bcrypt.compare(senhaAtual, hash);
  if (confere) await redisService.deleteKey(chave);
  return { confere, restantes: remaining };
};

// Com a senha provisória, a conta só pode trocá-la (e buscar o token anti-CSRF para isso); o resto espera.
// liberaSenhaProvisoria: só as rotas de que a troca da senha provisória precisa (POST /minha-senha, GET /csrf)
const autenticar = (liberaSenhaProvisoria: boolean) => async (req: Request, res: Response, next: NextFunction) => {
  // Tudo dentro do try: o Express 4 não captura erro de middleware async, e um erro solto derrubaria o processo
  try {
    const { token, viaCookie } = tokenDaRequisicao(req);
    if (!token) return res.status(401).json({ erro: 'Acesso negado. Token não fornecido.' });
    // Sessão antes do CSRF: com o token vencido o código anti-CSRF nem pode ser calculado, e a resposta certa é
    // "sessão expirada" (o front leva ao login e guarda o rascunho), não "proteção CSRF"
    const usuario = await validarSessao(token);
    if (!usuario) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    if (violaCsrf(req, token, viaCookie)) return res.status(403).json({ erro: 'Requisição recusada (proteção CSRF). Recarregue a página.', code: CODIGO_CSRF });
    if (usuario.trocarSenha && !liberaSenhaProvisoria) {
      return res.status(403).json({ erro: 'Troque a sua senha provisória para continuar.', code: CODIGO_TROCAR_SENHA });
    }
    (req as RequestAutenticado).user = { id: usuario.id, papel: usuario.papel };
    next();
  } catch (error) {
    next(error);
  }
};
export const verificarToken = autenticar(false);
export const verificarTokenSenhaProvisoria = autenticar(true);

export const verificarSupervisor = (req: Request, res: Response, next: NextFunction) => {
  if (!usuarioEhSupervisor(req)) {
    return res.status(403).json({ erro: 'Acesso negado. Ação restrita a supervisores e administradores.' });
  }
  next();
};

// Token válido + papel de supervisor ou admin
export const verificarSupervisorToken = (req: Request, res: Response, next: NextFunction) =>
  verificarToken(req, res, (erro?: unknown) => (erro ? next(erro) : verificarSupervisor(req, res, next)));
