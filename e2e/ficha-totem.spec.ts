import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

const M = '__ANAMNESE_JSON__:';
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean };

// O texto do cliente no totem não é filtrado: com o marcador dentro dele, regravar a observação dava 400 (forja) e o
// profissional não conseguia mais agendar o cliente
for (const [rotulo, obs] of [
  ['totem com o marcador no texto', `[Anamnese Autoatendimento 2026-01-01]: ${M}x`],
  ['totem com o marcador + ficha da equipe depois', `[Anamnese Autoatendimento 2026-01-01]: ${M}x\n${M}{"alergia":"Lavanda"}`],
] as const) {
  test(`profissional com acesso agenda pela tela: ${rotulo}`, async ({ page, request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco');
    test.setTimeout(120_000);
    const nome = nomeClienteTeste('Totem Marcador');
    const sup = await authHeaders(request, CONTAS.supervisor);
    expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
    const c = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as ClienteApi[]).find((x) => x.nome === nome)!;
    const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
    try { await db.cliente.update({ where: { id: c.id }, data: { observacao: obs } }); } finally { await db.$disconnect(); }
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = equipe.find((e) => e.email === CONTAS.colaboradora)!.id;
    try {
      let ok = false;
      for (let d = 1; d <= 5 && !ok; d += 1) for (const h of ['08:00', '19:00', '12:00', '15:00']) {
        const r = await request.post(`${apiBase()}/agendamentos`, { headers: sup, data: { collaboratorId: helenaId, date: diaFuturo(d), time: h, serviceNames: ['E2E Massagem'], clientId: c.id } });
        if (r.status() === 201) { ok = true; break; }
      }
      expect(ok).toBe(true);
      await page.goto('/');
      await loginPelaTela(page, CONTAS.colaboradora);
      const dia = diaFuturo(25);
      await page.locator('input[type="date"]').first().fill(dia);
      await page.getByRole('button', { name: /Agendar/i }).click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByPlaceholder('Digite nome, telefone ou CPF').fill(nome);
      await modal.getByRole('button', { name: new RegExp(nome) }).first().click();
      await modal.locator('input[type="date"]').first().fill(dia);
      await modal.getByRole('button', { name: /E2E Massagem/ }).first().click();
      const respostas: string[] = [];
      page.on('response', async (r) => { if (r.url().endsWith('/api/agendamentos') && r.request().method() === 'POST') respostas.push(`${r.status()} ${(await r.text()).slice(0, 160)}`); });
      let salvo = false;
      for (const h of ['09:00', '11:00', '14:00', '16:00']) {
        await modal.locator('input[type="time"]').first().fill(h);
        await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();
        try { await expect(modal).toBeHidden({ timeout: 5_000 }); salvo = true; break; } catch {
          const entendi = page.getByRole('button', { name: /Entendi/i });
          if (await entendi.count()) await entendi.first().click();
        }
      }
      expect(salvo, `profissional não conseguiu agendar o cliente: ${JSON.stringify(respostas)}`).toBe(true);
      const g = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as ClienteApi[]).find((x) => x.id === c.id)!;
      // A linha do totem volta intacta (regravar não é forja) e a ficha da equipe, se havia, continua valendo
      expect(g.observacao).toContain(obs.split('\n')[0]);
      if (obs.includes('Lavanda')) {
        expect(g.temAnamnese).toBe(true);
        expect(g.observacao).toContain('"alergia":"Lavanda"');
      }
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
}
