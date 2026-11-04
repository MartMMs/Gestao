import { test, expect } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';

/**
 * Vários agendamentos com clientes novos ao mesmo tempo (recepção e totem num dia cheio). No modo serializável, com
 * poucos dados, quaisquer duas gravações simultâneas colidiam ("A agenda mudou enquanto você salvava"); a agenda agora
 * grava com travas por chave (lib/transacao.ts, transacaoComTravas) e nenhuma deve falhar.
 * Teste de carga: só roda com E2E_CARGA=1 e sozinho (junto da suíte, a carga dele faz os outros testes colidirem):
 *   E2E_CARGA=1 npx playwright test e2e/api-agenda-simultanea.spec.ts
 */
// Sem o serializável, quem impede dois atendimentos no mesmo horário é a trava da agenda: este roda sempre (é leve)
test('mesmo profissional e horário pedidos ao mesmo tempo: só um grava', async ({ request }) => {
  const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers })).json()) as Array<{ id: string; papel: string; ativo?: boolean }>;
  const profissional = colabs.find((c) => c.papel === 'collaborator' && c.ativo !== false);
  test.skip(!profissional, 'Sem profissionais (rode o seed:ci).');
  const marca = `${Date.now()}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
  const nomes = Array.from({ length: 6 }, (_, i) => `Banca Mesmo Horario ${marca} ${'abcdef'[i]}`);
  const date = new Date(Date.now() + 130 * 86_400_000).toISOString().slice(0, 10);
  try {
    const respostas = await Promise.all(nomes.map((clientName) => request.post(`${apiBase()}/agendamentos`, {
      headers, data: { collaboratorId: profissional!.id, date, time: '11:00', serviceNames: ['E2E Massagem'], clientName },
    })));
    expect(respostas.map((r) => r.status()).sort()).toEqual([201, 409, 409, 409, 409, 409]);
  } finally {
    const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>;
    for (const cliente of clientes.filter((c) => nomes.includes(c.nome))) {
      const ags = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${cliente.id}`, { headers })).json()) as Array<{ id: string; atualizadoEm: string }>;
      for (const a of ags) await request.delete(`${apiBase()}/agendamentos/${a.id}`, { headers, data: { version: a.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${cliente.id}`, { headers });
    }
  }
});

test('12 agendamentos simultâneos de clientes novos: todos gravam', async ({ request }) => {
  test.skip(!process.env.E2E_CARGA, 'Teste de carga: rode sozinho com E2E_CARGA=1.');
  const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers })).json()) as Array<{ id: string; papel: string; ativo?: boolean }>;
  const profissionais = colabs.filter((c) => c.papel === 'collaborator' && c.ativo !== false);
  test.skip(profissionais.length === 0, 'Sem profissionais (rode o seed:ci).');
  const marca = `${Date.now()}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
  const nomes = Array.from({ length: 12 }, (_, i) => `Banca Simultanea ${marca} ${'abcdefghijkl'[i]}`);
  try {
    const respostas = await Promise.all(nomes.map((clientName, i) => request.post(`${apiBase()}/agendamentos`, {
      headers,
      data: {
        collaboratorId: profissionais[i % profissionais.length].id,
        date: new Date(Date.now() + (100 + i) * 86_400_000).toISOString().slice(0, 10),
        time: '10:00', serviceNames: ['E2E Massagem'], clientName,
      },
    })));
    const falhas = await Promise.all(respostas.filter((r) => r.status() !== 201).map(async (r) => `${r.status()} ${await r.text()}`));
    expect(falhas).toEqual([]);
  } finally {
    // Uma entrada só para limpar (entrar 20 vezes com a mesma conta faria os outros testes esperarem o login)
    const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>;
    for (const cliente of clientes.filter((c) => nomes.includes(c.nome))) {
      const ags = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${cliente.id}`, { headers })).json()) as Array<{ id: string; atualizadoEm: string }>;
      for (const a of ags) await request.delete(`${apiBase()}/agendamentos/${a.id}`, { headers, data: { version: a.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${cliente.id}`, { headers });
    }
  }
});
