import { request } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';

/**
 * Antes de qualquer execução: a chave global "exigir ficha de anamnese" começa desligada. Uma execução anterior que
 * caiu no meio do spec *.global.spec.ts (sem chegar ao afterAll) a deixaria ligada e quebraria os agendamentos de
 * toda a suíte seguinte.
 */
export default async function globalSetup() {
  const contexto = await request.newContext();
  try {
    const login = await postLogin(contexto, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
    if (!login.ok()) throw new Error(`globalSetup: login do admin falhou (${login.status()}): ${await login.text()}`);
    const { token } = await login.json();
    const resposta = await contexto.put(`${apiBase()}/empresa/config`, { headers: { Authorization: `Bearer ${token}` }, data: { exigirAnamnese: false } });
    if (!resposta.ok()) throw new Error(`globalSetup: não desligou exigirAnamnese (${resposta.status()}): ${await resposta.text()}`);
  } finally {
    await contexto.dispose();
  }
}
