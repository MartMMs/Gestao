import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSAO_COOKIE, SESSAO_TROCADA_EVENT, definirTokenCsrf, definirUsuarioDaSessao, fetchApi } from './api';

// Resposta mínima do fetch para os casos do teste
const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

describe('fetchApi: token anti-CSRF velho', () => {
  const eventos: string[] = [];
  beforeEach(() => {
    const alvo = new EventTarget();
    vi.stubGlobal('window', Object.assign(alvo, { location: { hostname: 'localhost', protocol: 'http:' } }));
    alvo.addEventListener(SESSAO_TROCADA_EVENT, () => eventos.push('trocada'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    definirUsuarioDaSessao('usuario-a');
    definirTokenCsrf('csrf-velho');
    eventos.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('busca o token de novo e repete a gravação quando o cookie ainda é da mesma pessoa', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resposta(403, { erro: 'Requisição recusada (proteção CSRF).', code: 'CSRF' }))
      .mockResolvedValueOnce(resposta(200, { csrf: 'csrf-novo', usuarioId: 'usuario-a' }))
      .mockResolvedValueOnce(resposta(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('/agendamentos', SESSAO_COOKIE, { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].headers['X-CSRF-Token']).toBe('csrf-novo');
  });

  it('não grava em nome de outra conta que entrou em outra aba', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(resposta(403, { erro: 'Requisição recusada (proteção CSRF).', code: 'CSRF' }))
      .mockResolvedValueOnce(resposta(200, { csrf: 'csrf-de-b', usuarioId: 'usuario-b' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('/agendamentos', SESSAO_COOKIE, { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: 'SESSAO_TROCADA' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(eventos).toEqual(['trocada']);
  });
});
