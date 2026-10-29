import { test, expect } from '@playwright/test';
import { CONTAS, E2E_PASSWORD } from './credenciais';

const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';

async function login(request: import('@playwright/test').APIRequestContext, email: string, senha: string) {
  const res = await request.post(`${apiBase()}/login`, {
    data: { email, senha },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok(), status: res.status(), token: body.token as string | undefined, body };
}

test.describe('API — conflito de agenda e permissao (LGPD lista)', () => {
  test('segundo POST no mesmo horario retorna 409', async ({ request }) => {
    const sup = await login(request, CONTAS.admin, E2E_PASSWORD);
    expect(sup.ok, `login supervisor: ${JSON.stringify(sup.body)}`).toBeTruthy();
    const token = sup.token!;

    const colabRes = await request.get(`${apiBase()}/colaboradores`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(colabRes.ok()).toBeTruthy();
    const colabs = (await colabRes.json()) as Array<{ id: string; email?: string | null }>;
    const collaborator = colabs.find((c) => c.email === 'helena@serenidade.com')
      ?? colabs[0];
    test.skip(!collaborator, 'Nenhum colaborador no banco (rode npx tsx prisma/seed.ci.ts no CI ou use base populada).');

    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 16);
    const y = day.getUTCFullYear();
    const m = String(day.getUTCMonth() + 1).padStart(2, '0');
    const d = String(day.getUTCDate()).padStart(2, '0');
    const dateIso = `${y}-${m}-${d}T11:00:00.000-03:00`;

    const serviceRes = await request.get(`${apiBase()}/servicos`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const servicos = (await serviceRes.json()) as Array<{ nome: string }>;
    const serviceName = servicos.find((s) => s.nome === 'E2E Massagem')?.nome ?? servicos[0]?.nome;
    test.skip(!serviceName, 'Nenhum servico cadastrado.');

    const baseBody = {
      collaboratorId: collaborator.id,
      date: dateIso,
      serviceNames: [serviceName],
    };

    const first = await request.post(`${apiBase()}/agendamentos`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        ...baseBody,
        clientName: `E2E Conflito A ${Date.now()}`,
        contact: '(11) 97777-1111',
      },
    });
    expect(first.status(), await first.text()).toBe(201);
    const created = await first.json();
    const appointmentId = created.id as string;

    const second = await request.post(`${apiBase()}/agendamentos`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        ...baseBody,
        clientName: `E2E Conflito B ${Date.now()}`,
        contact: '(11) 97777-2222',
      },
    });
    expect(second.status(), await second.text()).toBe(409);

    await request.delete(`${apiBase()}/agendamentos/${appointmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  });

  test('colaborador recebe CPF mascarado em GET /clientes quando houver CPF', async ({ request }) => {
    const colab = await login(request, CONTAS.colaboradora, E2E_PASSWORD);
    if (!colab.ok) {
      const alt = await login(request, CONTAS.colaboradoraAlternativa, E2E_PASSWORD);
      test.skip(!alt.ok, 'Colaborador de teste nao encontrado (helena ou ana).');
      Object.assign(colab, alt);
    }
    const token = colab.token!;

    const res = await request.get(`${apiBase()}/clientes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const list = (await res.json()) as Array<{ cpf?: string | null }>;
    const withCpf = list.filter((c) => c.cpf && String(c.cpf).length > 0);
    if (withCpf.length === 0) return;

    // Só os 2 últimos dígitos ficam visíveis
    const masked = /^\*{3}\.\*{3}\.\*{3}-\d{2}$/;
    for (const c of withCpf) {
      expect(c.cpf, `CPF nao mascarado para colaborador: ${c.cpf}`).toMatch(masked);
    }
  });

  test('supervisor recebe CPF completo (nao mascara de colaborador) em GET /clientes', async ({ request }) => {
    const sup = await login(request, CONTAS.admin, E2E_PASSWORD);
    expect(sup.ok).toBeTruthy();
    const token = sup.token!;

    const res = await request.get(`${apiBase()}/clientes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const list = (await res.json()) as Array<{ cpf?: string | null }>;
    const withCpf = list.find((c) => c.cpf && /^\d/.test(String(c.cpf)));
    if (!withCpf) return;

    expect(withCpf.cpf).not.toMatch(/^\*{3}\./);
  });
});
