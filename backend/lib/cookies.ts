import type { Request, Response } from 'express';
import { config } from '../env';

// Sessão em cookie HttpOnly: o JavaScript da página não lê o token, então um XSS não consegue roubá-lo
export const COOKIE_SESSAO = 'gestao_sessao';
// Cabeçalho exigido em escritas autenticadas por cookie. Outro site não consegue enviá-lo sem passar pelo CORS
// (preflight), e o CORS só libera as origens do sistema: isso fecha o CSRF sem token extra
export const CABECALHO_CSRF = 'x-requested-with';
export const VALOR_CSRF = 'gestao';

const producao = () => process.env.NODE_ENV === 'production';

export const gravarCookieSessao = (res: Response, token: string) => {
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: producao(),
    // Lax: o cookie vai nas chamadas do próprio sistema (mesmo site, inclusive subdomínios) e não em
    // formulários de outros sites
    sameSite: 'lax',
    path: '/',
    maxAge: config.jwtExpiraEmSegundos * 1000,
  });
};

export const apagarCookieSessao = (res: Response) => {
  res.clearCookie(COOKIE_SESSAO, { httpOnly: true, secure: producao(), sameSite: 'lax', path: '/' });
};

// Lê um cookie do cabeçalho bruto (sem dependência extra; também serve para o handshake do socket)
export const lerCookie = (cabecalho: string | undefined, nome: string): string | null => {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    if (parte.slice(0, separador).trim() !== nome) continue;
    try {
      return decodeURIComponent(parte.slice(separador + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

// Token da requisição: Authorization (scripts, integrações e testes) ou o cookie de sessão (navegador)
export const tokenDaRequisicao = (req: Request): { token: string | null; viaCookie: boolean } => {
  const cabecalho = req.headers.authorization;
  if (cabecalho?.startsWith('Bearer ')) return { token: cabecalho.slice(7) || null, viaCookie: false };
  const cookie = lerCookie(req.headers.cookie, COOKIE_SESSAO);
  return { token: cookie, viaCookie: Boolean(cookie) };
};

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Escrita autenticada por cookie precisa do cabeçalho anti-CSRF
export const violaCsrf = (req: Request, viaCookie: boolean) =>
  viaCookie && !METODOS_SEGUROS.has(req.method) && req.headers[CABECALHO_CSRF] !== VALOR_CSRF;
