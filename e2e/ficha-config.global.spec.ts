import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

// Mudam a config global da empresa: projeto configuracao-global, em série
test.describe.configure({ mode: 'serial' });
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean };

const ligarRegra = async (request: APIRequestContext, ligada: boolean) => {
  const r = await request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, CONTAS.admin), data: { exigirAnamnese: ligada } });
  expect(r.ok(), await r.text()).toBeTruthy();
};

test.describe('ficha obrigatória pela tela', () => {
  test.beforeAll(async ({ request }) => ligarRegra(request, true));
  test.afterAll(async ({ request }) => ligarRegra(request, false));

  test('recepção agenda cliente existente sem ficha: preenche pela tela e o agendamento grava a ficha sem apagar a nota', async ({ page, request }) => {
    test.setTimeout(120_000);
    const nome = nomeClienteTeste('BancaTeste Obrig');
    const sup = await authHeaders(request, CONTAS.supervisor);
    expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
    const c = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as ClienteApi[]).find((x) => x.nome === nome)!;
    expect((await request.put(`${apiBase()}/clientes/${c.id}`, { headers: sup, data: { observacao: 'Prefere a sala 2' } })).status()).toBe(200);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: /Agendar/i }).first().click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByPlaceholder('Digite nome, telefone ou CPF').fill(nome);
      await modal.getByRole('button', { name: new RegExp(nome) }).first().click();

      // "Ver ficha" do card: com a ficha obrigatória faltando, a recepção pode preencher
      await modal.getByRole('button', { name: 'Ver ficha', exact: true }).click();
      const resumo = page.getByRole('dialog', { name: /Resumo da ficha de anamnese/i });
      await expect(resumo.getByText(/exige a ficha para agendar/)).toBeVisible();
      await resumo.getByRole('button', { name: 'Preencher ficha', exact: true }).click();
      const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true });
      await ficha.locator('label:has-text("Tem alguma alergia?") + input').fill('Pólen');
      await ficha.getByRole('button', { name: /Concluir ficha/ }).click();
      await expect(ficha).toBeHidden();

      let salvo = false;
      for (const d of [30, 31, 32, 33]) {
        await modal.locator('input[type="date"]').first().fill(diaFuturo(d));
        const servico = modal.getByRole('button', { name: /E2E Massagem/ }).first();
        if (!(await servico.textContent())?.includes('Selecionado')) await servico.click();
        const profissional = modal.locator('select').first();
        const opcoes = await profissional.locator('option:not([disabled])').all();
        if (opcoes.length && !(await profissional.inputValue())) await profissional.selectOption({ index: 1 });
        for (const h of ['09:00', '11:00', '14:00', '16:00']) {
          await modal.locator('input[type="time"]').first().fill(h);
          await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();
          try { await expect(modal).toBeHidden({ timeout: 5_000 }); salvo = true; break; } catch {
            const entendi = page.getByRole('button', { name: /Entendi/i });
            if (await entendi.count()) await entendi.first().click();
          }
        }
        if (salvo) break;
      }
      expect(salvo, 'agendamento não salvo').toBe(true);
      const gravado = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as ClienteApi[]).find((x) => x.id === c.id)!;
      expect(gravado.temAnamnese).toBe(true);
      expect(gravado.observacao).toContain('Prefere a sala 2');
      expect(gravado.observacao).toContain('Pólen');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});

const abrirEmpresa = async (page: Page) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.admin);
  await page.getByRole('button', { name: /Empresa & Segmento/i }).click();
};

test.describe('Empresa não sobrescreve o que foi digitado', () => {
  test.describe.configure({ mode: 'serial' });

  test('edição local + config nova de fora: aviso, texto mantido; "Descartar" carrega a nova', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const atual = await (await request.get(`${apiBase()}/empresa/config`, { headers: admin })).json();
    try {
      await abrirEmpresa(page);
      const slogan = page.getByPlaceholder(/Cuidado, excelência/);
      const endereco = page.getByPlaceholder(/Rua das Flores/);
      await expect(endereco).toHaveValue(atual.endereco ?? '');
      await slogan.fill('BancaTeste slogan local');
      const novo = 'BancaTeste endereco de fora';
      expect((await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: novo } })).status()).toBe(200);
      const aviso = page.getByRole('status').filter({ hasText: /alterada em outra tela ou aparelho/ });
      await expect(aviso).toBeVisible({ timeout: 10_000 });
      await expect(slogan).toHaveValue('BancaTeste slogan local');
      await expect(endereco).toHaveValue(atual.endereco ?? '');
      await aviso.getByRole('button', { name: /Descartar/ }).click();
      await expect(endereco).toHaveValue(novo);
      await expect(slogan).toHaveValue(atual.slogan ?? '');
      await expect(aviso).toHaveCount(0);
    } finally {
      await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: atual.endereco } });
    }
  });

  test('sem edição local, config de fora entra calada', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const atual = await (await request.get(`${apiBase()}/empresa/config`, { headers: admin })).json();
    try {
      await abrirEmpresa(page);
      const endereco = page.getByPlaceholder(/Rua das Flores/);
      await expect(endereco).toHaveValue(atual.endereco ?? '');
      const novo = 'BancaTeste endereco calado';
      expect((await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: novo } })).status()).toBe(200);
      await expect(endereco).toHaveValue(novo, { timeout: 10_000 });
      await expect(page.getByText(/alterada em outra tela ou aparelho/)).toHaveCount(0);
    } finally {
      await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: atual.endereco } });
    }
  });

  test('depois de "Salvar" sem mudança, editar e receber config de fora ainda mostra o aviso', async ({ page, request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const atual = await (await request.get(`${apiBase()}/empresa/config`, { headers: admin })).json();
    try {
      await abrirEmpresa(page);
      const slogan = page.getByPlaceholder(/Cuidado, excelência/);
      const endereco = page.getByPlaceholder(/Rua das Flores/);
      await expect(endereco).toHaveValue(atual.endereco ?? '');
      const salvo = page.waitForResponse((r) => r.url().endsWith('/api/empresa/config') && r.request().method() === 'PUT');
      await page.getByRole('button', { name: /Salvar Configurações da Empresa/ }).click();
      expect((await salvo).status()).toBe(200);
      await page.waitForTimeout(1500);
      await slogan.fill('BancaTeste digitado depois de salvar');
      expect((await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: 'BancaTeste endereco depois' } })).status()).toBe(200);
      await page.waitForTimeout(3000);
      await expect(slogan, 'o que foi digitado foi apagado pela config de fora').toHaveValue('BancaTeste digitado depois de salvar');
      await expect(page.getByText(/alterada em outra tela ou aparelho/)).toBeVisible();
    } finally {
      await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: atual.endereco } });
    }
  });
});

