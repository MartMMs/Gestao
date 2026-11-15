import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAutoatendimentoConfig, fetchAutoatendimentoServicos } from './services/autoatendimentoService';

describe('totem com muitos acessos (429)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('catálogo e configuração dizem para aguardar, em vez de "falha"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(fetchAutoatendimentoServicos()).rejects.toThrow(/Muitos acessos agora/);
    await expect(fetchAutoatendimentoConfig()).rejects.toThrow(/Muitos acessos agora/);
  });

  it('outro erro mantém a mensagem de falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(fetchAutoatendimentoServicos()).rejects.toThrow(/Falha ao carregar catálogo/);
  });
});
