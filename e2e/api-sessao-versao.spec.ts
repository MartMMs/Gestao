import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, loginPelaTela, postLogin } from './credenciais';

const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';
const PREFIXO_CLIENTE = 'E2E Versão';

async function loginToken(request: APIRequestContext, email: string) {
  const res = await postLogin(request, { data: { email, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok(), token: body.token as string | undefined, body };
}

type Contexto = { auth: Record<string, string>; helena: { id: string }; ana?: { id: string }; servico: string };

async function prepararContexto(request: APIRequestContext): Promise<Contexto> {
  const sup = await loginToken(request, CONTAS.admin);
  expect(sup.ok, `login admin: ${JSON.stringify(sup.body)}`).toBeTruthy();
  const auth = { Authorization: `Bearer ${sup.token}` };
  const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: auth })).json()) as Array<{ id: string; email?: string | null }>;
  const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
  const ana = colabs.find((c) => c.email === CONTAS.colaboradoraAlternativa);
  test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');
  const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: auth })).json()) as Array<{ nome: string }>;
  const servico = servicos.find((s) => s.nome === 'E2E Massagem')?.nome;
  test.skip(!servico, 'Serviço "E2E Massagem" não encontrado (rode o seed:ci).');
  return { auth, helena: helena!, ana, servico: servico! };
}

// Dia e horário sorteados (com nova tentativa se já estiver ocupado): execuções em paralelo e restos de uma
// execução interrompida não colidem
async function criarAgendamento(request: APIRequestContext, ctx: Contexto) {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    const dia = new Date(Date.now() + (20 + Math.floor(Math.random() * 60)) * 86_400_000).toISOString().slice(0, 10);
    const minutos = 9 * 60 + 30 * Math.floor(Math.random() * 20); // 09:00 a 18:30
    const horario = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const res = await request.post(`${apiBase()}/agendamentos`, {
      headers: ctx.auth,
      data: {
        collaboratorId: ctx.helena.id, date: `${dia}T${horario}:00.000-03:00`, serviceNames: [ctx.servico],
        clientName: `${PREFIXO_CLIENTE} ${Date.now()}-${tentativa}`, contact: '(11) 97777-3333',
      },
    });
    if (res.status() === 409) continue;
    expect(res.status(), await res.text()).toBe(201);
    const ag = await res.json();
    return { id: ag.id as string, versao: ag.atualizadoEm as string, dia, horario };
  }
  throw new Error('Nenhum horário livre encontrado em 8 tentativas.');
}

test.describe('API — sessão em cookie e proteção CSRF', () => {
  test('login do navegador: cookie HttpOnly, sem token no corpo; escrita exige o cabeçalho', async () => {
    // Contexto próprio: os cookies deste teste não vazam para os outros
    const ctx = await playwrightRequest.newContext();
    try {
      const login = await postLogin(ctx, { data: { email: CONTAS.admin, senha: E2E_PASSWORD } });
      expect(login.ok(), await login.text()).toBeTruthy();
      const corpoLogin = await login.json();
      expect(corpoLogin.token).toBeUndefined();
      expect(typeof corpoLogin.csrf).toBe('string');
      const CSRF = { 'X-CSRF-Token': corpoLogin.csrf as string };
      const setCookie = login.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
      expect(setCookie).toMatch(/gestao_sessao=/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=(Lax|Strict)/i);

      // Leitura só com o cookie funciona
      expect((await ctx.get(`${apiBase()}/colaboradores`)).status()).toBe(200);

      // Escrita só com o cookie é recusada sem o token anti-CSRF, com um token inventado ou com o cabeçalho
      // antigo de valor fixo (e a sessão continua)
      expect((await ctx.post(`${apiBase()}/logout`)).status()).toBe(403);
      expect((await ctx.post(`${apiBase()}/logout`, { headers: { 'X-CSRF-Token': 'inventado' } })).status()).toBe(403);
      expect((await ctx.post(`${apiBase()}/logout`, { headers: { 'X-Requested-With': 'gestao' } })).status()).toBe(403);
      // A página recarregada busca o token da sessão em GET /csrf: o mesmo da resposta do login
      expect((await (await ctx.get(`${apiBase()}/csrf`)).json()).csrf).toBe(corpoLogin.csrf);
      expect((await ctx.get(`${apiBase()}/colaboradores`)).status()).toBe(200);

      // Com o cabeçalho o logout passa, e o mesmo cookie deixa de valer
      const cookies = await ctx.storageState();
      expect((await ctx.post(`${apiBase()}/logout`, { headers: CSRF })).status()).toBe(204);
      const reaproveitado = await playwrightRequest.newContext({ storageState: cookies });
      try {
        expect((await reaproveitado.get(`${apiBase()}/colaboradores`)).status()).toBe(401);
      } finally {
        await reaproveitado.dispose();
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('lista da equipe não expõe versão do token nem hash de senha', async ({ request }) => {
    const { auth } = await prepararContexto(request);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: auth })).json()) as Array<Record<string, unknown>>;
    expect(equipe.length).toBeGreaterThan(0);
    for (const pessoa of equipe) {
      expect(pessoa).not.toHaveProperty('versaoToken');
      expect(pessoa).not.toHaveProperty('senha');
    }
  });
});

test.describe('API — versão do agendamento e registros encerrados', () => {
  test('PUT exige a versão atual e grava a mudança; reassign confere a versão', async ({ request }) => {
    const ctx = await prepararContexto(request);
    const ag = await criarAgendamento(request, ctx);
    try {
      const put = (body: Record<string, unknown>) => request.put(`${apiBase()}/agendamentos/${ag.id}`, {
        headers: ctx.auth, data: { date: ag.dia, time: ag.horario, assignedEmployeeId: ctx.helena.id, ...body },
      });

      // Sem versão: 428; com versão inventada: 409
      expect((await put({})).status()).toBe(428);
      expect((await put({ version: '2000-01-01T00:00:00.000Z' })).status()).toBe(409);

      // Versão atual passa e a observação é gravada; repetir a mesma versão (outra aba) dá 409
      const primeiro = await put({ version: ag.versao, observation: 'Alterado pelo e2e' });
      expect(primeiro.status(), await primeiro.text()).toBe(200);
      const editado = await primeiro.json();
      expect(editado.observacoesSaude).toBe('Alterado pelo e2e');
      expect(editado.atualizadoEm).not.toBe(ag.versao);
      expect((await put({ version: ag.versao, observation: 'Outra aba' })).status()).toBe(409);

      // Realocar com a versão de antes da edição é recusado; com a atual, passa
      const velho = await request.patch(`${apiBase()}/agendamentos/${ag.id}/reassign`, {
        headers: ctx.auth, data: { newEmployeeId: ctx.ana?.id ?? ctx.helena.id, version: ag.versao },
      });
      expect(velho.status()).toBe(409);
      if (ctx.ana) {
        const realocado = await request.patch(`${apiBase()}/agendamentos/${ag.id}/reassign`, {
          headers: ctx.auth, data: { newEmployeeId: ctx.ana.id, version: editado.atualizadoEm },
        });
        expect(realocado.status(), await realocado.text()).toBe(200);
        expect((await realocado.json()).colaboradorId).toBe(ctx.ana.id);
      }

      // Status igual ao atual devolve o agendamento só com o necessário do profissional
      const mesmoStatus = await request.patch(`${apiBase()}/agendamentos/${ag.id}/status`, { headers: ctx.auth, data: { status: 'scheduled' } });
      expect(mesmoStatus.status(), await mesmoStatus.text()).toBe(200);
      const corpo = await mesmoStatus.json();
      expect(corpo.colaborador?.id).toBeTruthy();
      expect(corpo.colaborador?.nome).toBeTruthy();
      expect(corpo.colaborador).not.toHaveProperty('senha');
      expect(corpo.colaborador).not.toHaveProperty('email');
      expect(corpo.colaborador).not.toHaveProperty('versaoToken');
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: ctx.auth });
    }
  });

  test('encerrado: só a observação muda; reabrir exige versão e fica no histórico', async ({ request }) => {
    const ctx = await prepararContexto(request);
    const ag = await criarAgendamento(request, ctx);
    try {
      // Cancelar com versão velha é recusado; com a atual, passa
      const status = (body: Record<string, unknown>) => request.patch(`${apiBase()}/agendamentos/${ag.id}/status`, { headers: ctx.auth, data: body });
      expect((await status({ status: 'cancelled', version: '2000-01-01T00:00:00.000Z' })).status()).toBe(409);
      const cancelado = await status({ status: 'cancelled', version: ag.versao });
      expect(cancelado.status(), await cancelado.text()).toBe(200);
      let versao = (await cancelado.json()).atualizadoEm as string;

      // Encerrado não muda horário nem profissional
      const put = (body: Record<string, unknown>) => request.put(`${apiBase()}/agendamentos/${ag.id}`, {
        headers: ctx.auth, data: { date: ag.dia, time: ag.horario, assignedEmployeeId: ctx.helena.id, version: versao, ...body },
      });
      const outroHorario = ag.horario === '09:00' ? '09:30' : '09:00';
      const mudarHorario = await put({ time: outroHorario });
      expect(mudarHorario.status()).toBe(409);
      expect(await mudarHorario.text()).toMatch(/encerrado/);
      if (ctx.ana) {
        const realocar = await request.patch(`${apiBase()}/agendamentos/${ag.id}/reassign`, {
          headers: ctx.auth, data: { newEmployeeId: ctx.ana.id, version: versao },
        });
        expect(realocar.status()).toBe(409);
        expect(await realocar.text()).toMatch(/encerrado/);
      }

      // Só a observação muda (sem esbarrar em validação de agenda)
      const observacao = await put({ observation: 'Cliente avisou por telefone' });
      expect(observacao.status(), await observacao.text()).toBe(200);
      versao = (await observacao.json()).atualizadoEm;

      // Reabrir: sem versão 428, versão velha 409, versão atual 200
      expect((await status({ status: 'scheduled' })).status()).toBe(428);
      expect((await status({ status: 'scheduled', version: ag.versao })).status()).toBe(409);
      const reaberto = await status({ status: 'scheduled', version: versao });
      expect(reaberto.status(), await reaberto.text()).toBe(200);
      expect((await reaberto.json()).status).toBe('scheduled');

      // A reabertura fica no histórico de alterações
      const auditoria = (await (await request.get(`${apiBase()}/auditoria`, { headers: ctx.auth })).json()) as Array<{ acao: string; antes: { status?: string }; depois: { status?: string } }>;
      const registro = auditoria.find((r) => r.acao === 'agendamento.reaberto' && r.antes?.status === 'cancelled');
      expect(registro?.depois?.status).toBe('scheduled');
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: ctx.auth });
    }
  });

  test('colaborador não recebe o percentual de comissão dos serviços', async ({ request }) => {
    let colab = await loginToken(request, CONTAS.colaboradora);
    if (!colab.ok) colab = await loginToken(request, CONTAS.colaboradoraAlternativa);
    test.skip(!colab.ok, 'Colaborador de teste não encontrado (helena ou ana).');

    const res = await request.get(`${apiBase()}/servicos`, { headers: { Authorization: `Bearer ${colab.token}` } });
    expect(res.ok()).toBeTruthy();
    for (const servico of (await res.json()) as Array<Record<string, unknown>>) {
      expect(servico).not.toHaveProperty('comissaoPercentual');
    }

    const totem = await request.get(`${apiBase()}/autoatendimento/servicos`);
    expect(totem.ok()).toBeTruthy();
    for (const servico of (await totem.json()) as Array<Record<string, unknown>>) {
      expect(servico).not.toHaveProperty('comissaoPercentual');
    }
  });
});

test.describe('UI — sessão encerrada por inatividade', () => {
  test('inatividade revoga a sessão no servidor (o cookie antigo deixa de valer)', async ({ page, context }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.colaboradora);
    await expect(page.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();
    const cookiesDaSessao = await context.storageState();

    // Simula 20 minutos parado (limite: 15) e recarrega: a tela volta ao login e chama /logout
    await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem('spa_session_meta') ?? '{}');
      const parado = Date.now() - 20 * 60_000;
      localStorage.setItem('spa_session_meta', JSON.stringify({ ...meta, lastActivityAt: parado, inactivityExpiresAt: parado + 15 * 60_000 }));
    });
    const logout = page.waitForRequest((req) => req.url().endsWith('/logout') && req.method() === 'POST');
    await page.reload();
    expect((await logout).headers()['x-csrf-token']).toBeTruthy();
    await (await logout).response();

    // Quem reaproveitar o cookie de antes (ex.: outra pessoa no mesmo computador) recebe 401
    const reaproveitado = await playwrightRequest.newContext({ storageState: cookiesDaSessao });
    try {
      expect((await reaproveitado.get(`${apiBase()}/colaboradores`)).status()).toBe(401);
    } finally {
      await reaproveitado.dispose();
    }
  });
});
