import { test, expect } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, escolherDiaFuturoNoTotem, loginPelaTela, nomeClienteTeste } from './credenciais';

test.describe.configure({ mode: 'serial' });

test.describe('Autoatendimento - Modo Admin, Agendamento Sem Pagamento & Mobile', () => {
  test('Supervisor acessa aba Totem & Autoatendimento, altera configurações e visualiza simulador mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    await loginPelaTela(page, CONTAS.supervisor);

    // Clica na nova aba "Totem & Autoatendimento"
    const tabAdmin = page.getByRole('button', { name: /Totem & Autoatendimento/i });
    await expect(tabAdmin).toBeVisible();
    await tabAdmin.click();

    // Valida abertura do painel administrativo
    await expect(page.getByRole('heading', { name: /Configurações do Autoatendimento/i })).toBeVisible();
    await expect(page.getByText(/Exigência de Pagamento/i)).toBeVisible();
    await expect(page.getByText(/Totem & Autoatendimento Ativo/i)).toBeVisible();

    // Tira screenshot do Painel Admin
    await page.screenshot({ path: test.info().outputPath('09_admin_autoatendimento_config.png') });

    // Clica no botão "Simulador Mobile"
    const btnSimulador = page.getByRole('button', { name: /Simulador Mobile/i });
    await expect(btnSimulador).toBeVisible();
    await btnSimulador.click();

    // Valida que a moldura do smartphone apareceu
    await expect(page.getByText(/Simulador de Acessibilidade Mobile/i)).toBeVisible();
    await expect(page.getByText(/Touch Target Seguro/i)).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('10_admin_simulador_mobile.png') });

    // Garante que a exigência de pagamento fique desligada para o modo sem pagamento (apenas agendamento)
    const togglePagamento = page.locator('input[type="checkbox"]').first();
    if (await togglePagamento.isChecked()) {
      await togglePagamento.click({ force: true });
    }

    // Salva as configurações
    await page.getByRole('button', { name: /Salvar Alterações/i }).click();
    await expect(page.getByText(/Configurações salvas e aplicadas/i)).toBeVisible({ timeout: 10_000 });
  });

  test('Fluxo completo de Autoatendimento SEM PAGAMENTO (Pagar no Local) no Mobile', async ({ browser, request }) => {
    const nomeCliente = nomeClienteTeste('Carolina Mendes');
    try {
      // Cria contexto com resolução mobile de smartphone real (iPhone 13/14: 390x844)
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();

      await page.goto('/');

      // 1. Tela Inicial no Mobile
      const btnTotem = page.getByRole('button', { name: /Autoatendimento/i });
      await expect(btnTotem).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('11_mobile_01_inicio.png') });
      await btnTotem.click();

      // 2. Catálogo no Mobile
      await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: test.info().outputPath('12_mobile_02_catalogo.png') });

      // Seleciona terapia
      const cardTerapia = page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first();
      await cardTerapia.click();

      const btnAvancar = page.getByRole('button', { name: /Escolher Horário/i });
      await expect(btnAvancar).toBeEnabled();
      await btnAvancar.click();

      // 3. Escolha de Data e Horário no Mobile
      await expect(page.getByRole('heading', { name: /Disponibilidade em Tempo Real/i })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: test.info().outputPath('13_mobile_03_horarios.png') });

      // Seleciona o primeiro slot livre (não desabilitado)
      await escolherDiaFuturoNoTotem(page);
      await escolherDiaFuturoNoTotem(page);
    const slotButton = page.locator('button:has(span:has-text(":")):not([disabled])').first();
      await expect(slotButton).toBeVisible({ timeout: 10_000 });
      await slotButton.click();

      const btnLock = page.getByRole('button', { name: /Garantir Reserva/i });
      await expect(btnLock).toBeEnabled({ timeout: 10_000 });
      await btnLock.click();

      // 4. Anamnese no Mobile
      await expect(page.getByRole('heading', { name: /Ficha Personalizada do Spa/i })).toBeVisible({ timeout: 15_000 });
      await page.locator('input[placeholder*="Mariana" i]').fill(nomeCliente);
      await page.locator('input[placeholder*="98765" i]').fill('(11) 97777-6655');
      await page.screenshot({ path: test.info().outputPath('14_mobile_04_anamnese.png') });

      const btnIrPagamento = page.getByRole('button', { name: /Ir para Pagamento|Revisar e Confirmar/i });
      await btnIrPagamento.click();

      // 5. Etapa 4: Confirmação Direta SEM PAGAMENTO (Pagar no Local)
      await expect(page.getByRole('heading', { name: /Agendamento com Pagamento no Local/i })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Pagamento Presencial na Recepção/i)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('15_mobile_05_checkout_no_local.png') });

      // Clica em confirmar agendamento
      const btnConfirmar = page.getByRole('button', { name: /Confirmar Agendamento \(Pagar no Local\)/i });
      await expect(btnConfirmar).toBeVisible();
      await btnConfirmar.click();

      // 6. Voucher no Mobile com status "A Pagar na Recepção"
      await expect(page.getByRole('heading', { name: /Seu Momento de Bem-Estar/i })).toBeVisible({ timeout: 20_000 });
      // O serviço do seed de CI custa R$ 0: sem pagamento exigido, o voucher mostra "Sem custo" (pago, seria "A Pagar na Recepção")
      await expect(page.getByText(/^(A Pagar na Recepção.*|Sem custo)$/i)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('16_mobile_06_voucher_no_local.png') });

      await context.close();
    } finally {
      // Remove o cliente e o agendamento criados pelo teste
      await apagarClienteDeTeste(request, nomeCliente);
    }
  });
});
