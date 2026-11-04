import { test, expect } from '@playwright/test';
import { CONTAS, loginPelaTela } from './credenciais';

test.describe('UI — agenda: visões de semana e mês', () => {
  test('supervisor alterna Dia, Semana e Mês, vê a legenda de cada visão e volta ao dia pelo calendário', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await expect(page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible();
    await page.getByRole('button', { name: /^Agenda$/i }).click();
    await expect(page.getByPlaceholder(/Buscar Cliente ou Servi[cç]o/i)).toBeVisible();

    // Dia: legenda da grade, com o estado "sem baixa" separado da falta
    await expect(page.getByLabel('Legenda de cores da agenda')).toContainText(/Sem baixa/i);
    await expect(page.getByLabel('Legenda de cores da agenda')).toContainText(/Falta/i);

    // Semana: legenda própria e navegação por semana
    await page.getByRole('button', { name: 'Semana', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Legenda de cores', { exact: true })).toContainText(/sem baixa/i);
    await expect(page.getByRole('button', { name: 'Próxima semana' })).toBeVisible();

    // Mês: 7 colunas de dias da semana e navegação por mês; o filtro de folga avisa que vale só no Dia
    await page.getByRole('button', { name: 'Mês', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Próximo mês' })).toBeVisible();
    await page.getByRole('combobox').filter({ hasText: /Profissional/ }).selectOption({ label: 'Profissional: Somente de folga' });
    await expect(page.getByText(/vale só na visão Dia/i)).toBeVisible();

    // Clicar no dia abre a grade daquele dia
    await page.getByRole('button', { name: /^15: .*Abrir na grade$/ }).click();
    await expect(page.getByRole('button', { name: 'Dia', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Legenda de cores da agenda')).toBeVisible();
  });
});
