import { test, expect } from '@playwright/test';
import { apiBase } from './credenciais';
import { VERSAO_CONSENTIMENTO_SAUDE } from '../shared/consentimento';

// LGPD: o totem não cria reserva sem a autorização marcada e a versão do texto aceito (gravadas como prova)
test('totem: confirmar sem consentimento ou sem a versão do texto é recusado', async ({ request }) => {
  const cliente = { nome: 'Cliente Consentimento', telefone: '(11) 97777-6655', observacoesSaude: '' };
  const sessionToken = `consentimento-${Date.now()}`;
  const tentativas = [
    { consentimento: undefined, consentimentoVersao: VERSAO_CONSENTIMENTO_SAUDE },
    { consentimento: false, consentimentoVersao: VERSAO_CONSENTIMENTO_SAUDE },
    { consentimento: 'true', consentimentoVersao: VERSAO_CONSENTIMENTO_SAUDE },
    { consentimento: true },
    { consentimento: true, consentimentoVersao: 'x'.repeat(50) },
    { consentimento: true, consentimentoVersao: '2026-11-03' },
  ];
  for (const extra of tentativas) {
    const r = await request.post(`${apiBase()}/autoatendimento/confirmar-pagamento`, { data: { sessionToken, cliente: { ...cliente, ...extra } } });
    expect(r.status(), JSON.stringify(extra)).toBe(400);
    expect((await r.json()).erro).toMatch(/autorização de uso dos dados/);
  }
  // Com tudo certo passa da validação (e para na reserva inexistente)
  const ok = await request.post(`${apiBase()}/autoatendimento/confirmar-pagamento`, {
    data: { sessionToken, cliente: { ...cliente, consentimento: true, consentimentoVersao: VERSAO_CONSENTIMENTO_SAUDE } },
  });
  expect(ok.status()).not.toBe(400);
});
