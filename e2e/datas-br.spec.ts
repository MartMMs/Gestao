import { test, expect, type Page } from '@playwright/test';
import { CONTAS, loginPelaTela } from './credenciais';

/** Exibição de datas: telas principais mostram DD/MM/YYYY e nenhuma data ISO (AAAA-MM-DD) no texto renderizado. */

const ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const semIso = async (page: Page, tela: string) => {
  await page.waitForLoadState('networkidle');
  const texto = await page.locator('body').innerText();
  expect(texto.match(ISO)?.[0], `data ISO visível em ${tela}`).toBeUndefined();
};

test('supervisor: agenda, RH (grade e Horas Previstas) e relatórios sem datas ISO', async ({ page }) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.supervisor);
  await semIso(page, 'início do supervisor');

  await page.getByRole('button', { name: /^Agenda$/i }).click();
  await semIso(page, 'agenda');

  await page.getByRole('button', { name: /^Relatórios$/i }).click();
  await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  await semIso(page, 'relatórios');

  await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
  await page.getByRole('button', { name: /Grade de Escalas/i }).click();
  await semIso(page, 'grade de escalas');
  await page.getByRole('tab', { name: /Horas Previstas/i }).click();
  await semIso(page, 'Horas Previstas');
});

test('colaboradora: início e Minha Escala sem datas ISO', async ({ page }) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.colaboradora);
  await semIso(page, 'início da colaboradora');
  await page.getByRole('button', { name: /Ver minha escala/i }).click();
  await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  await semIso(page, 'Minha Escala');
});

test('totem: catálogo e escolha de horário sem datas ISO', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Autoatendimento/i }).click();
  await expect(page.getByText(/Etapa 1 de 4/i)).toBeVisible({ timeout: 15_000 });
  await semIso(page, 'totem etapa 1');
  await page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first().click();
  await page.getByRole('button', { name: /Escolher Horário/i }).click();
  await expect(page.getByText(/Datas Disponíveis/i)).toBeVisible({ timeout: 15_000 });
  await semIso(page, 'totem etapa 2');
});
