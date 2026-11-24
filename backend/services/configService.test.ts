import type { ConfiguracaoEmpresa } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ prisma: {} }));
const { EMPRESA_PADRAO, empresaPublica } = await import('./configService');

const empresa = {
  ...EMPRESA_PADRAO,
  usarComissao: true,
  exigirAnamnese: true,
  exigenciaHabilidades: 'sempre',
  horaAbertura: '09:00',
  horaFechamento: '21:00',
  horaLimiteAgendamento: null,
  diasFuncionamento: [1, 2, 3],
  mensagensLembrete: ['Oi {nome}'],
  lembretePedeConfirmacao: true,
  atualizadoEm: new Date('2026-11-21T12:00:00Z'),
  campoSecretoNovo: 'nao pode sair',
} as ConfiguracaoEmpresa;

describe('configuração da empresa para quem não está logado', () => {
  it('lista branca: tira textos do WhatsApp e qualquer campo novo, mantém o que o front usa', () => {
    const publica = empresaPublica(empresa);
    expect(publica).not.toHaveProperty('mensagensLembrete');
    expect(publica).not.toHaveProperty('lembretePedeConfirmacao');
    expect(publica).not.toHaveProperty('campoSecretoNovo');
    expect(publica).toMatchObject({ nomeEmpresa: EMPRESA_PADRAO.nomeEmpresa, exigirAnamnese: true, diasFuncionamento: [1, 2, 3] });
  });

  it('whatsappAtivo é falso sem provedor configurado', () => {
    expect(empresaPublica(empresa).whatsappAtivo).toBe(false);
  });
});
