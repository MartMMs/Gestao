import { randomBytes } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { io } from 'socket.io-client';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';
import { CODIGO_TROCAR_SENHA } from '../shared/codigosErro';

/**
 * Senha provisória (conta criada ou senha redefinida pela supervisão): a pessoa precisa trocá-la antes de usar o
 * sistema. A regra vale no servidor, não só na tela.
 */
const senhaAleatoria = () => `Teste-${randomBytes(12).toString('base64url')}`;

async function criarConta(request: APIRequestContext, papel = 'collaborator') {
  const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const admin = { Authorization: `Bearer ${(await login.json()).token}` };
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const letras = marca.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
  const email = `provisoria.${marca}@teste.local`;
  const provisoria = senhaAleatoria();
  const criado = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome: `Banca Provisoria ${letras}`, email, senha: provisoria, papel, especialidade: 'Teste' },
  });
  expect(criado.status(), await criado.text()).toBe(201);
  const { id } = await criado.json();
  return { id, email, provisoria, admin, apagar: () => request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin }) };
}

test.describe('Senha provisória', () => {
  test('API: com a provisória só dá para trocar a senha; depois da troca a sessão nova vale e a antiga não', async ({ request }) => {
    // Supervisor: o único papel (além do admin) que chega ao cadastro da equipe, onde a própria senha não pode mudar
    const conta = await criarConta(request, 'supervisor');
    try {
      const login = await postLogin(request, { data: { email: conta.email, senha: conta.provisoria }, headers: { 'X-Auth-Mode': 'token' } });
      expect(login.status()).toBe(200);
      const corpo = await login.json();
      expect(corpo.usuario.trocarSenha).toBe(true);
      const bearer = { Authorization: `Bearer ${corpo.token}` };
      // Outra sessão aberta com a mesma senha: também cai na troca
      const outraSessao = { Authorization: `Bearer ${(await (await postLogin(request, { data: { email: conta.email, senha: conta.provisoria }, headers: { 'X-Auth-Mode': 'token' } })).json()).token}` };

      const bloqueado = await request.get(`${apiBase()}/agendamentos`, { headers: bearer });
      expect(bloqueado.status()).toBe(403);
      expect((await bloqueado.json()).code).toBe(CODIGO_TROCAR_SENHA);

      const nova = senhaAleatoria();
      const errada = await request.post(`${apiBase()}/minha-senha`, { headers: bearer, data: { senhaAtual: 'nao-e-esta', senha: nova } });
      expect(errada.status()).toBe(403);
      const igual = await request.post(`${apiBase()}/minha-senha`, { headers: bearer, data: { senhaAtual: conta.provisoria, senha: conta.provisoria } });
      expect(igual.status()).toBe(400);

      const trocada = await request.post(`${apiBase()}/minha-senha`, { headers: bearer, data: { senhaAtual: conta.provisoria, senha: nova } });
      expect(trocada.status(), await trocada.text()).toBe(200);
      expect((await trocada.json()).usuario.trocarSenha).toBe(false);
      // O token da sessão com a senha provisória deixou de valer; o cookie novo (gravado na resposta) vale
      expect((await request.get(`${apiBase()}/agendamentos`, { headers: bearer })).status()).toBe(401);
      expect((await request.get(`${apiBase()}/csrf`, { headers: outraSessao })).status()).toBe(401);
      expect((await request.get(`${apiBase()}/agendamentos`)).status()).toBe(200);
      // A provisória não entra mais; a nova entra direto, sem pedir troca
      expect((await postLogin(request, { data: { email: conta.email, senha: conta.provisoria } })).status()).toBe(401);
      const comNova = await postLogin(request, { data: { email: conta.email, senha: nova }, headers: { 'X-Auth-Mode': 'token' } });
      const corpoNova = await comNova.json();
      expect(corpoNova.usuario.trocarSenha).toBe(false);
      // A própria senha só muda por /minha-senha (com auditoria e sessão nova), não pelo cadastro
      const pelaEquipe = await request.put(`${apiBase()}/colaboradores/${conta.id}`, {
        headers: { Authorization: `Bearer ${corpoNova.token}` }, data: { senha: senhaAleatoria(), senhaAtual: nova },
      });
      expect(pelaEquipe.status(), await pelaEquipe.text()).toBe(400);

      // Supervisão redefine a senha: vira provisória de novo
      const reset = await request.put(`${apiBase()}/colaboradores/${conta.id}`, { headers: conta.admin, data: { senha: senhaAleatoria() } });
      expect(reset.status(), await reset.text()).toBe(200);
      expect((await reset.json()).trocarSenha).toBe(true);
    } finally {
      await conta.apagar();
    }
  });

  test('API: a senha atual aceita no máximo 5 conferências erradas (sessão aberta não vira banco de chutes)', async ({ request }) => {
    const conta = await criarConta(request);
    try {
      const login = await postLogin(request, { data: { email: conta.email, senha: conta.provisoria }, headers: { 'X-Auth-Mode': 'token' } });
      const bearer = { Authorization: `Bearer ${(await login.json()).token}` };
      const avisos: string[] = [];
      for (let i = 0; i < 5; i++) {
        const errada = await request.post(`${apiBase()}/minha-senha`, { headers: bearer, data: { senhaAtual: `chute-${i}`, senha: senhaAleatoria() } });
        expect(errada.status()).toBe(403);
        avisos.push((await errada.json()).erro);
      }
      expect(avisos[0]).toMatch(/Restam 4 tentativa/);
      expect(avisos[3]).toMatch(/Restam 1 tentativa/);
      expect(avisos[4]).toMatch(/bloqueada por até 15 minutos/);
      // Nem a senha certa passa enquanto o limite vale: acertar depois de 5 chutes não pode ser possível
      const certa = await request.post(`${apiBase()}/minha-senha`, { headers: bearer, data: { senhaAtual: conta.provisoria, senha: senhaAleatoria() } });
      expect(certa.status(), await certa.text()).toBe(429);

      // A supervisão redefine a senha: a provisória nova funciona na hora (o bloqueio era contra a antiga)
      const nova = senhaAleatoria();
      expect((await request.put(`${apiBase()}/colaboradores/${conta.id}`, { headers: conta.admin, data: { senha: nova } })).status()).toBe(200);
      const login2 = await postLogin(request, { data: { email: conta.email, senha: nova }, headers: { 'X-Auth-Mode': 'token' } });
      const bearer2 = { Authorization: `Bearer ${(await login2.json()).token}` };
      const trocada = await request.post(`${apiBase()}/minha-senha`, { headers: bearer2, data: { senhaAtual: nova, senha: senhaAleatoria() } });
      expect(trocada.status(), await trocada.text()).toBe(200);
    } finally {
      await conta.apagar();
    }
  });

  test('socket: conta com a senha provisória conecta como público, sem os avisos da equipe', async ({ request }) => {
    const conta = await criarConta(request);
    const login = async (email: string, senha: string) =>
      (await (await postLogin(request, { data: { email, senha }, headers: { 'X-Auth-Mode': 'token' } })).json()).token as string;
    const conectar = (token: string) => new Promise<ReturnType<typeof io>>((ok, falha) => {
      const s = io(new URL(apiBase()).origin, { auth: { token }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => ok(s));
      s.on('connect_error', falha);
    });
    const proximoAviso = (s: ReturnType<typeof io>) => new Promise<unknown>((ok) => {
      const t = setTimeout(() => ok('NADA'), 4000);
      s.once('db_updated', (d) => { clearTimeout(t); ok(d); });
    });
    const equipe = await conectar(await login(CONTAS.admin, E2E_PASSWORD));
    const provisoria = await conectar(await login(conta.email, conta.provisoria));
    try {
      const [avisoEquipe, avisoProvisoria] = [proximoAviso(equipe), proximoAviso(provisoria)];
      // Mudança na equipe: quem está na sala da equipe recebe os escopos; o público recebe só {} (ou nada)
      const outra = await criarConta(request);
      expect(await avisoEquipe).toHaveProperty('escopos');
      const recebido = await avisoProvisoria;
      expect(recebido === 'NADA' || JSON.stringify(recebido) === '{}', `recebeu ${JSON.stringify(recebido)}`).toBe(true);
      await outra.apagar();
    } finally {
      equipe.close();
      provisoria.close();
      await conta.apagar();
    }
  });

  test('tela: com duas abas, trocar a senha numa tira a outra da tela de troca', async ({ browser, request }) => {
    const conta = await criarConta(request);
    const contexto = await browser.newContext();
    try {
      const aba1 = await contexto.newPage();
      await aba1.goto('/');
      await aba1.getByLabel(/E-mail/i).fill(conta.email);
      await aba1.getByLabel(/^Senha$/i).fill(conta.provisoria);
      await aba1.getByRole('button', { name: /Entrar/i }).click();
      await expect(aba1.getByRole('heading', { name: /Crie a sua senha/i })).toBeVisible({ timeout: 30_000 });
      const aba2 = await contexto.newPage();
      await aba2.goto('/');
      await expect(aba2.getByRole('heading', { name: /Crie a sua senha/i })).toBeVisible({ timeout: 30_000 });

      const nova = senhaAleatoria();
      await aba1.getByLabel('Senha provisória', { exact: true }).fill(conta.provisoria);
      await aba1.getByLabel('Nova senha', { exact: true }).fill(nova);
      await aba1.getByLabel('Repita a nova senha').fill(nova);
      await aba1.getByRole('button', { name: /Salvar e entrar/i }).click();
      await expect(aba1.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible({ timeout: 30_000 });
      await expect(aba2.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible({ timeout: 30_000 });
    } finally {
      await contexto.close();
      await conta.apagar();
    }
  });

  test('tela: o primeiro acesso pede a senha nova e depois abre o portal', async ({ page, request }) => {
    const conta = await criarConta(request);
    try {
      await page.goto('/');
      await page.getByLabel(/E-mail/i).fill(conta.email);
      await page.getByLabel(/^Senha$/i).fill(conta.provisoria);
      await page.getByRole('button', { name: /Entrar/i }).click();
      await expect(page.getByRole('heading', { name: /Crie a sua senha/i })).toBeVisible({ timeout: 30_000 });

      const nova = senhaAleatoria();
      await page.getByLabel('Senha provisória', { exact: true }).fill(conta.provisoria);
      await page.getByLabel('Nova senha', { exact: true }).fill(nova);
      await page.getByLabel('Repita a nova senha').fill(`${nova}x`);
      await page.getByRole('button', { name: /Salvar e entrar/i }).click();
      await expect(page.getByRole('alert')).toHaveText('A confirmação não é igual à nova senha.');

      await page.getByLabel('Repita a nova senha').fill(nova);
      await page.getByRole('button', { name: /Salvar e entrar/i }).click();
      await expect(page.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible({ timeout: 30_000 });
    } finally {
      await conta.apagar();
    }
  });
});
