import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
const { empresaPublica } = await import('./configService');

describe('configuração da empresa para quem não está logado', () => {
  it('tira os textos e a ligação da confirmação do WhatsApp e mantém o resto', () => {
    const publica = empresaPublica({ nomeEmpresa: 'Spa', exigirAnamnese: true, mensagensLembrete: ['Oi {nome}'], lembretePedeConfirmacao: true });
    expect(publica).toEqual({ nomeEmpresa: 'Spa', exigirAnamnese: true });
    expect(publica).not.toHaveProperty('mensagensLembrete');
    expect(publica).not.toHaveProperty('lembretePedeConfirmacao');
  });
});
