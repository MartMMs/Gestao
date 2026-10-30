import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { CONTAS, E2E_PASSWORD } from './credenciais';

const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';
const CSRF = { 'X-Requested-With': 'gestao' };

async function loginToken(request: APIRequestContext, email: string) {
  const res = await request.post(`${apiBase()}/login`, { data: { email, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok(), token: body.token as string | undefined, body };
}

test.describe('API — sessão em cookie e proteção CSRF', () => {
  test('login do navegador: cookie HttpOnly, sem token no corpo; escrita exige o cabeçalho', async () => {
    // Contexto próprio: os cookies deste teste não vazam para os outros
    const ctx = await playwrightRequest.newContext();
    try {
      const login = await ctx.post(`${apiBase()}/login`, { data: { email: CONTAS.admin, senha: E2E_PASSWORD } });
      expect(login.ok(), await login.text()).toBeTruthy();
      expect((await login.json()).token).toBeUndefined();
      const setCookie = login.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).join('\n');
      expect(setCookie).toMatch(/gestao_sessao=/);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=(Lax|Strict)/i);

      // Leitura só com o cookie funciona
      expect((await ctx.get(`${apiBase()}/colaboradores`)).status()).toBe(200);

      // Escrita só com o cookie e sem o cabeçalho anti-CSRF é recusada (e a sessão continua)
      expect((await ctx.post(`${apiBase()}/logout`)).status()).toBe(403);
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
});

test.describe('API — versão do agendamento e dados expostos', () => {
  test('PUT exige a versão atual; reassign com versão velha dá 409; status repetido não expõe o profissional', async ({ request }) => {
    const sup = await loginToken(request, CONTAS.admin);
    expect(sup.ok, `login supervisor: ${JSON.stringify(sup.body)}`).toBeTruthy();
    const auth = { Authorization: `Bearer ${sup.token}` };

    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: auth })).json()) as Array<{ id: string; email?: string | null }>;
    const collaborator = colabs.find((c) => c.email === 'helena@serenidade.com') ?? colabs[0];
    test.skip(!collaborator, 'Nenhum colaborador no banco (rode o seed:ci).');
    const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: auth })).json()) as Array<{ nome: string }>;
    const serviceName = servicos.find((s) => s.nome === 'E2E Massagem')?.nome ?? servicos[0]?.nome;
    test.skip(!serviceName, 'Nenhum serviço cadastrado.');

    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 17);
    const data = day.toISOString().slice(0, 10);
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: auth,
      data: { collaboratorId: collaborator.id, date: `${data}T10:00:00.000-03:00`, serviceNames: [serviceName], clientName: `E2E Versão ${Date.now()}`, contact: '(11) 97777-3333' },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const ag = await criado.json();
    const versaoInicial = ag.atualizadoEm as string;

    try {
      const put = (body: Record<string, unknown>) => request.put(`${apiBase()}/agendamentos/${ag.id}`, {
        headers: auth, data: { date: data, time: '10:00', assignedEmployeeId: collaborator.id, ...body },
      });

      // Sem versão: 428; com versão inventada: 409
      expect((await put({})).status()).toBe(428);
      expect((await put({ version: '2000-01-01T00:00:00.000Z' })).status()).toBe(409);

      // Versão atual passa; repetir a mesma versão (outra aba) dá 409
      const primeiro = await put({ version: versaoInicial, time: '10:30' });
      expect(primeiro.status(), await primeiro.text()).toBe(200);
      expect((await put({ version: versaoInicial, time: '11:00' })).status()).toBe(409);

      // Realocar com a versão de antes da edição também é recusado
      const realocar = await request.patch(`${apiBase()}/agendamentos/${ag.id}/reassign`, {
        headers: auth, data: { newEmployeeId: collaborator.id, version: versaoInicial },
      });
      expect(realocar.status()).toBe(409);

      // Status igual ao atual devolve o agendamento sem dados internos do profissional (hash, e-mail)
      const mesmoStatus = await request.patch(`${apiBase()}/agendamentos/${ag.id}/status`, { headers: auth, data: { status: 'scheduled' } });
      expect(mesmoStatus.status(), await mesmoStatus.text()).toBe(200);
      const corpo = await mesmoStatus.json();
      expect(corpo.colaborador?.senha).toBeUndefined();
      expect(corpo.colaborador?.email).toBeUndefined();
      expect(corpo.colaborador?.versaoToken).toBeUndefined();
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: auth });
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
