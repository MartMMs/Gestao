import { test, expect } from '@playwright/test';

// Termos e Política abrem do login (sem sessão), com o nome da empresa da configuração, e fecham com Esc
test('login: Termos de Uso e Política de Privacidade abrem em modal com o nome da empresa', async ({ page }) => {
  await page.goto('/');
  for (const titulo of ['Política de Privacidade', 'Termos de Uso']) {
    await page.getByRole('button', { name: titulo }).click();
    const dialogo = page.getByRole('dialog', { name: titulo });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText('Última atualização', { exact: false })).toBeVisible();
    await expect(dialogo.getByText(/Atualizado|\{\{/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
  }
});
