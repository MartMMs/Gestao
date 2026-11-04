import { randomBytes } from 'node:crypto';
import { CODIGO_DESAFIO_NECESSARIO } from '../shared/codigosErro';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { resolverDesafio } from '../shared/provaDeTrabalho';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';

/**
 * Modo de segurança do login: depois de 3 erros no mesmo e-mail e aparelho, entrar exige a prova de trabalho.
 * Usa uma conta criada só para o teste: errar a senha das contas compartilhadas poria os outros testes no modo.
 */
// Senha nova a cada execução: se a limpeza falhar, a conta que sobra não tem senha conhecida
const SENHA = `Teste-${randomBytes(12).toString('base64url')}`;

async function criarConta(request: APIRequestContext) {
  const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const auth = { Authorization: `Bearer ${(await login.json()).token}` };
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const letras = marca.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
  const email = `robo.${marca}@teste.local`;
  const criado = await request.post(`${apiBase()}/colaboradores`, {
    headers: auth, data: { nome: `Banca Robo ${letras}`, email, senha: SENHA, papel: 'collaborator', especialidade: 'Teste' },
  });
  expect(criado.status(), await criado.text()).toBe(201);
  const { id } = await criado.json();
  return { email, apagar: () => request.delete(`${apiBase()}/colaboradores/${id}`, { headers: auth }) };
}

const entrar = (request: APIRequestContext, email: string, senha: string, extra: Record<string, unknown> = {}) =>
  request.post(`${apiBase()}/login`, { data: { email, senha, ...extra }, headers: { 'X-Auth-Mode': 'token' } });

test.describe('Login — modo de segurança contra robôs', () => {
  test('3 erros ativam a prova de trabalho; prova vale uma vez, só para o mesmo e-mail; com a prova certa entra; campo-isca barra', async ({ request }) => {
    const conta = await criarConta(request);
    try {
      // Campo-isca preenchido: recusado como senha errada, mesmo com a senha certa (e não gasta tentativa)
      expect((await entrar(request, conta.email, SENHA, { campo_controle: 'http://spam' })).status()).toBe(401);
      for (let i = 0; i < 3; i += 1) expect((await entrar(request, conta.email, 'errada-123')).status()).toBe(401);

      // Depois de 3 erros: sem a prova, a senha nem é conferida (mesmo a certa)
      const semProva = await entrar(request, conta.email, SENHA);
      expect(semProva.status()).toBe(401);
      const corpo = await semProva.json();
      expect(corpo.code).toBe(CODIGO_DESAFIO_NECESSARIO);
      expect(corpo.desafio.dificuldade).toBeGreaterThanOrEqual(16);

      // Prova inventada não vale
      const inventada = await entrar(request, conta.email, SENHA, { desafio: { id: corpo.desafio.id, nonce: '1' } });
      expect((await inventada.json()).code).toBe(CODIGO_DESAFIO_NECESSARIO);

      // Prova resolvida para OUTRO e-mail não vale para este
      const outroEmail = `outro.${conta.email}`;
      for (let i = 0; i < 3; i += 1) await entrar(request, outroEmail, 'errada-123');
      const desafioDoOutro = (await (await entrar(request, outroEmail, 'errada-123')).json()).desafio;
      const provaDoOutro = { id: desafioDoOutro.id, nonce: await resolverDesafio(desafioDoOutro) };
      expect((await (await entrar(request, conta.email, SENHA, { desafio: provaDoOutro })).json()).code).toBe(CODIGO_DESAFIO_NECESSARIO);

      // Prova certa com senha errada: a prova é consumida e a resposta é a de senha errada
      const desafio1 = (await (await entrar(request, conta.email, SENHA)).json()).desafio;
      const prova1 = { id: desafio1.id, nonce: await resolverDesafio(desafio1) };
      const senhaErrada = await entrar(request, conta.email, 'errada-123', { desafio: prova1 });
      expect(senhaErrada.status()).toBe(401);
      expect((await senhaErrada.json()).code).toBeUndefined();
      // A mesma prova não serve de novo, nem com a senha certa
      expect((await (await entrar(request, conta.email, SENHA, { desafio: prova1 })).json()).code).toBe(CODIGO_DESAFIO_NECESSARIO);

      // Com uma prova nova e a senha certa, entra
      const desafio2 = (await (await entrar(request, conta.email, SENHA)).json()).desafio;
      const ok = await entrar(request, conta.email, SENHA, { desafio: { id: desafio2.id, nonce: await resolverDesafio(desafio2) } });
      expect(ok.status(), await ok.text()).toBe(200);
      expect((await ok.json()).csrf).toBeTruthy();
    } finally {
      await conta.apagar();
    }
  });

  test('na tela, o login resolve a prova sozinho e entra', async ({ page, request }) => {
    const conta = await criarConta(request);
    try {
      for (let i = 0; i < 3; i += 1) await entrar(request, conta.email, 'errada-123');
      await page.goto('/');
      await page.getByLabel(/E-mail/i).fill(conta.email);
      await page.getByLabel(/^Senha$/i).fill(SENHA);
      const login = page.waitForResponse((r) => r.url().endsWith('/login') && r.status() === 200);
      await page.getByRole('button', { name: /Entrar/i }).click();
      // O primeiro envio recebe o desafio; o segundo (com a prova) entra
      expect((await (await login).request().postDataJSON()).desafio?.nonce).toBeTruthy();
      // Conta recém-criada pela supervisão: entrou, e o primeiro passo é criar a senha própria
      await expect(page.getByRole('heading', { name: /Crie a sua senha/i })).toBeVisible({ timeout: 30_000 });
    } finally {
      await conta.apagar();
    }
  });
});

// Tenta entrar resolvendo a prova de trabalho quando o servidor pedir (como o navegador faz)
async function tentar(request: APIRequestContext, email: string, senha: string) {
  let res = await entrar(request, email, senha);
  const corpo = res.status() === 401 ? await res.json().catch(() => null) : null;
  if (corpo?.code === CODIGO_DESAFIO_NECESSARIO) {
    res = await entrar(request, email, senha, { desafio: { id: corpo.desafio.id, nonce: await resolverDesafio(corpo.desafio) } });
  }
  return res;
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe('Login — espera por conta (ataque distribuído)', () => {
  test.setTimeout(120_000);

  test('a partir do 5º erro a conta espera; senha certa depois da espera entra; aparelho conhecido não espera', async ({ request }) => {
    const conta = await criarConta(request);
    try {
      for (let i = 0; i < 5; i += 1) expect((await tentar(request, conta.email, 'errada-123')).status()).toBe(401);
      // Logo depois do 5º erro: recusa até a senha certa, sem conferir
      const durante = await tentar(request, conta.email, SENHA);
      expect(durante.status()).toBe(429);
      expect((await durante.json()).erro).toMatch(/Aguarde \d+ s/);
      await esperar(1_200);
      const ok = await tentar(request, conta.email, SENHA);
      expect(ok.status(), await ok.text()).toBe(200);
      // Este IP agora é aparelho conhecido: erro seguido de outro não espera (a dona não fica presa por um robô)
      expect((await tentar(request, conta.email, 'errada-123')).status()).toBe(401);
      expect((await tentar(request, conta.email, 'errada-123')).status()).toBe(401);
    } finally {
      await conta.apagar();
    }
  });

  test('várias senhas ao mesmo tempo durante a espera: só uma é conferida', async ({ request }) => {
    const conta = await criarConta(request);
    try {
      for (let i = 0; i < 5; i += 1) expect((await tentar(request, conta.email, 'errada-123')).status()).toBe(401);
      await esperar(1_200);
      // Provas resolvidas antes (o robô faz isso), e as senhas disparadas juntas
      const desafios = [];
      for (let i = 0; i < 4; i += 1) desafios.push((await (await entrar(request, conta.email, 'x')).json()).desafio);
      const provas = await Promise.all(desafios.map(async (d) => ({ id: d.id, nonce: await resolverDesafio(d) })));
      const respostas = await Promise.all(provas.map((desafio) => entrar(request, conta.email, 'errada-123', { desafio })));
      const status = respostas.map((r) => r.status()).sort();
      expect(status).toEqual([401, 429, 429, 429]);
    } finally {
      await conta.apagar();
    }
  });
});
