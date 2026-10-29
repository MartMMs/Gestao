import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { prisma } from './db';
import { redisService } from './services/redisService';

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
export const validarSessao = async (token: string): Promise<UsuarioToken | null> => {
  const payload = decodificarToken(token);
  if (!payload) return null;
  if (payload.jti && await redisService.get(chaveRevogado(payload.jti))) return null;
  const usuario = await prisma.colaborador.findUnique({ where: { id: payload.id }, select: { ativo: true, papel: true, versaoToken: true } });
  if (!usuario?.ativo || payload.v !== usuario.versaoToken) return null;
  return { id: payload.id, papel: usuario.papel as Papel };
};

export const verificarToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Acesso negado. Token não fornecido.' });

  try {
    const usuario = await validarSessao(token);
    if (!usuario) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    (req as RequestAutenticado).user = usuario;
    next();
  } catch (error) {
    next(error);
  }
};

export const verificarSupervisor = (req: Request, res: Response, next: NextFunction) => {
  if (!usuarioEhSupervisor(req)) {
    return res.status(403).json({ erro: 'Acesso negado. Ação restrita a supervisores e administradores.' });
  }
  next();
};

// Token válido + papel de supervisor ou admin
export const verificarSupervisorToken = (req: Request, res: Response, next: NextFunction) =>
  verificarToken(req, res, (erro?: unknown) => (erro ? next(erro) : verificarSupervisor(req, res, next)));
