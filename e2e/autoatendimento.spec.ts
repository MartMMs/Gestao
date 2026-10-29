import { test, expect } from '@playwright/test';
import { CONTAS, loginPelaTela } from './credenciais';

test.describe('Aba de Autoatendimento (Totem / Self-Service)', () => {
  test('visitante abre autoatendimento direto da tela de login, visualiza catálogo e navega', async ({ page }) => {
    await page.goto('/');
    
    // Verifica botão de autoatendimento no topo da tela de login
    const btnAutoatendimento = page.getByRole('button', { name: /Autoatendimento/i });
    await expect(btnAutoatendimento).toBeVisible();
    await btnAutoatendimento.click();

    // Valida que o Totem de Autoatendimento foi renderizado com Catálogo
    await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Etapa 1 de 4/i)).toBeVisible();

    // Clica no card da primeira terapia para selecionar
    const cardTerapia = page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first();
    await expect(cardTerapia).toBeVisible({ timeout: 15_000 });
    await cardTerapia.click();

    // Clica no botão para avançar para a escolha do horário
    const btnAvancar = page.getByRole('button', { name: /Escolher Horário/i });
    await expect(btnAvancar).toBeEnabled();
    await btnAvancar.click();

    // Valida transição para o Passo 2: Horário & Cabine
    await expect(page.getByRole('heading', { name: /Disponibilidade em Tempo Real/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Datas Disponíveis/i)).toBeVisible();

    // Clica em Voltar ao Portal / Login
    const btnVoltar = page.getByRole('button', { name: /Voltar ao Portal/i });
    await expect(btnVoltar).toBeVisible();
    await btnVoltar.click();

    // Retorna à tela inicial de login
    await expect(page.getByRole('button', { name: /Entrar/i })).toBeVisible();
  });

  test('supervisor pode alternar para o Totem pelo seletor de portal e retornar', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);

    // Seleciona Autoatendimento no seletor de portal (visível no desktop)
    const selector = page.locator('select').first();
    await expect(selector).toBeVisible();
    await selector.selectOption('autoatendimento');

    // Valida abertura do Autoatendimento
    await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });

    // Clica para voltar ao portal
    const btnVoltar = page.getByRole('button', { name: /Voltar ao Portal/i });
    await expect(btnVoltar).toBeVisible();
    await btnVoltar.click();

    // Retorna ao portal supervisor
    await expect(page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible();
  });
});
