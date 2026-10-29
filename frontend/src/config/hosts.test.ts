import { afterEach, describe, expect, it, vi } from 'vitest';

// O módulo lê as variáveis do Vite ao ser carregado: cada teste importa uma cópia nova
const carregar = async () => {
  vi.resetModules();
  return import('./hosts');
};

afterEach(() => vi.unstubAllEnvs());

describe('isAutoatendimentoHost', () => {
  it('reconhece o subdomínio padrão', async () => {
    const { isAutoatendimentoHost } = await carregar();
    expect(isAutoatendimentoHost('autoatendimento.spa.com.br')).toBe(true);
    expect(isAutoatendimentoHost('AUTOATENDIMENTO.spa.com.br')).toBe(true);
  });

  it('não confunde o portal da equipe com o totem', async () => {
    const { isAutoatendimentoHost } = await carregar();
    expect(isAutoatendimentoHost('app.spa.com.br')).toBe(false);
    expect(isAutoatendimentoHost('localhost')).toBe(false);
    expect(isAutoatendimentoHost('meuautoatendimento.spa.com.br')).toBe(false);
    expect(isAutoatendimentoHost('')).toBe(false);
  });

  it('com host configurado, aceita só ele', async () => {
    vi.stubEnv('VITE_AUTOATENDIMENTO_HOST', 'totem.spa.com.br');
    const { isAutoatendimentoHost } = await carregar();
    expect(isAutoatendimentoHost('totem.spa.com.br')).toBe(true);
    expect(isAutoatendimentoHost('autoatendimento.spa.com.br')).toBe(false);
  });
});

describe('isAutoatendimentoHost com lista', () => {
  it('aceita vários hosts separados por vírgula', async () => {
    vi.stubEnv('VITE_AUTOATENDIMENTO_HOST', 'totem.spa.com.br, WWW.totem.spa.com.br');
    const { isAutoatendimentoHost } = await carregar();
    expect(isAutoatendimentoHost('www.totem.spa.com.br')).toBe(true);
    expect(isAutoatendimentoHost('totem.spa.com.br')).toBe(true);
    expect(isAutoatendimentoHost('app.spa.com.br')).toBe(false);
  });
});

describe('getAutoatendimentoUrl', () => {
  it('sem configuração, abre o totem no próprio portal', async () => {
    vi.stubEnv('VITE_AUTOATENDIMENTO_URL', '');
    const { getAutoatendimentoUrl } = await carregar();
    expect(getAutoatendimentoUrl()).toBeNull();
  });

  it('recusa esquemas que não sejam http(s)', async () => {
    vi.stubEnv('VITE_AUTOATENDIMENTO_URL', 'javascript:alert(1)');
    const { getAutoatendimentoUrl } = await carregar();
    expect(getAutoatendimentoUrl()).toBeNull();
  });

  it('aceita uma URL https', async () => {
    vi.stubEnv('VITE_AUTOATENDIMENTO_URL', 'https://autoatendimento.spa.com.br');
    const { getAutoatendimentoUrl } = await carregar();
    expect(getAutoatendimentoUrl()).toBe('https://autoatendimento.spa.com.br/');
  });
});
