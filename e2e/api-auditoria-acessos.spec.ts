import { test, expect, type APIRequestContext } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';

async function auth(request: APIRequestContext, email: string) {
  const res = await postLogin(request, { data: { email, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).token}` };
}

const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

test.describe('API — trilha de acessos ao histórico de clientes', () => {
  test('supervisão vê quem abriu o histórico, com filtros; recepção e colaborador não', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    const adminId = colabs.find((c) => c.email === CONTAS.admin)?.id;
    test.skip(!helena || !adminId, 'Contas de teste não encontradas (rode o seed:ci).');

    const nome = `Auditoria Acesso ${Date.now()}`;
    const data = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin, data: { collaboratorId: helena!.id, date: data, time: '11:00', serviceNames: ['E2E Massagem'], clientName: nome },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const ag = await criado.json();
    try {
      // Abrir o histórico do cliente grava o acesso
      expect((await request.get(`${apiBase()}/agendamentos?clienteId=${ag.clienteId}`, { headers: admin })).ok()).toBeTruthy();

      const supervisor = await auth(request, CONTAS.supervisor);
      const url = (q: Record<string, string>) => `${apiBase()}/auditoria/acessos-historico?${new URLSearchParams({ de: hoje(), ate: hoje(), ...q })}`;
      const res = await request.get(url({ cliente: nome.toLowerCase(), colaboradorId: adminId! }), { headers: supervisor });
      expect(res.status(), await res.text()).toBe(200);
      const pagina = await res.json();
      expect(pagina.total).toBe(1);
      expect(pagina.itens[0]).toMatchObject({ clienteNome: nome, registros: 1 });
      expect(typeof pagina.itens[0].colaboradorNome).toBe('string');

      // Outro profissional no filtro: some
      expect((await (await request.get(url({ cliente: nome, colaboradorId: helena!.id }), { headers: supervisor })).json()).total).toBe(0);
      // Período sem o acesso: some
      expect((await (await request.get(url({ cliente: nome, de: '2020-01-01', ate: '2020-01-31' }), { headers: supervisor })).json()).total).toBe(0);
      // Período inválido: 400
      expect((await request.get(url({ de: '2026-13-01' }), { headers: supervisor })).status()).toBe(400);

      for (const conta of [CONTAS.recepcao, CONTAS.colaboradora]) {
        expect((await request.get(url({}), { headers: await auth(request, conta) })).status(), conta).toBe(403);
      }
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { version: ag.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${ag.clienteId}`, { headers: admin });
    }
  });
});
