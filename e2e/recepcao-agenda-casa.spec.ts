import { test, expect } from '@playwright/test';
import { CONTAS, loginPelaTela } from './credenciais';

// A recepção trabalha na agenda da casa (todos os profissionais), sem as ações exclusivas da supervisão
test('recepção vê a agenda da casa, sem bloqueio e sem a agenda pessoal escondida por baixo', async ({ page }) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.recepcao);
  await expect(page.getByRole('heading', { name: /Portal da Recepção/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Agenda da Recepção' })).toBeVisible();
  // Colunas de mais de um profissional (a agenda pessoal mostraria só a da própria conta)
  await expect(page.getByRole('heading', { name: 'Helena', level: 4 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ana', level: 4 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bloqueio/i })).toHaveCount(0);
  await expect(page.getByText('Minha Agenda')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Portal' })).toHaveValue('receptionist');
});
