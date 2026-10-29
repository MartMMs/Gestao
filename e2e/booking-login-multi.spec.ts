import { test, expect } from '@playwright/test';
import { CONTAS, loginPelaTela } from './credenciais';

async function loginComPerfil(
  page: import('@playwright/test').Page,
  perfil: 'Colaborador' | 'Supervisor',
) {
  await page.goto('/');
  await loginPelaTela(page, perfil === 'Supervisor' ? CONTAS.supervisor : CONTAS.colaboradora);
}

test.describe('UI — login e multi-contexto', () => {
  test('login de colaborador abre portal apos carregar dados', async ({ page }) => {
    await loginComPerfil(page, 'Colaborador');
    await expect(page.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();
  });

  test('duas janelas independentes: ambas logam como colaborador sem erro', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    try {
      await Promise.all([
        (async () => {
          await loginComPerfil(p1, 'Colaborador');
          await expect(p1.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();
        })(),
        (async () => {
          await loginComPerfil(p2, 'Colaborador');
          await expect(p2.getByRole('heading', { name: /Portal do Colaborador/i })).toBeVisible();
        })(),
      ]);
    } finally {
      await Promise.all([ctx1.close(), ctx2.close()]);
    }
  });

  test('supervisor ve seletor de portal na barra', async ({ page }) => {
    await loginComPerfil(page, 'Supervisor');
    await expect(page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible();
  });
});
