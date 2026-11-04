import { test, expect } from '@playwright/test';
import { apagarClienteDeTeste, nomeClienteTeste, reservarHorarioNoTotem } from './credenciais';

test('Capturar capturas de tela completas do fluxo de Autoatendimento', async ({ page, request }) => {
  const nomeCliente = nomeClienteTeste('Mariana Alencar');
  try {
    // 1. Tela Inicial com Botão de Autoatendimento
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Autoatendimento/i })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath('01_login_com_totem.png') });

    // 2. Entra no Autoatendimento -> Catálogo de Terapias
    await page.getByRole('button', { name: /Autoatendimento/i }).click();
    await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: test.info().outputPath('02_catalogo_terapias.png') });

    // 3. Seleciona a primeira terapia
    const cardTerapia = page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first();
    await expect(cardTerapia).toBeVisible({ timeout: 15_000 });
    await cardTerapia.click();
    await page.screenshot({ path: test.info().outputPath('03_terapia_selecionada.png') });

    // 4. Avança para a Etapa 2: Horários & Espaço
    const btnAvancar = page.getByRole('button', { name: /Escolher Horário/i });
    await expect(btnAvancar).toBeEnabled();
    await btnAvancar.click();
    await expect(page.getByRole('heading', { name: /Disponibilidade em Tempo Real/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('04_horarios.png') });

    // 5 e 6. Escolhe um horário livre e garante a reserva (lock no Redis), com nova tentativa se precisar
    await reservarHorarioNoTotem(page);
    await page.screenshot({ path: test.info().outputPath('05_slot_reservado.png') });

    // 7. Etapa 3: Identificação & Anamnese
    await expect(page.getByRole('heading', { name: /Seus dados para o atendimento/i })).toBeVisible({ timeout: 15_000 });
    await page.locator('input[placeholder*="Mariana" i]').fill(nomeCliente);
    await page.locator('input[placeholder*="98765" i]').fill('(11) 98765-4321');
    await page.screenshot({ path: test.info().outputPath('06_identificacao_anamnese.png') });

    // 8. Avança para Etapa 4: Garantia & Pagamento (Timer de 10 min + Pix)
    const btnIrPagamento = page.getByRole('button', { name: /Ir para Pagamento|Revisar e Confirmar/i });
    await expect(btnIrPagamento).toBeEnabled();
    await page.getByRole('checkbox', { name: /Autorizo .* a usar meus dados pessoais/i }).check();
    await btnIrPagamento.click();

    // O título muda conforme a configuração: pagamento online ou pagamento na recepção
    await expect(page.getByRole('heading', { name: /Pagamento & Confirmação|Pagamento no Local/i })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('07_checkout_com_timer_redis.png') });

    // 9. Confirma o pagamento (simulação) para gerar o Voucher
    const btnConfirmar = page.getByRole('button', { name: /Fiz o PIX|Confirmar/i }).first();
    await expect(btnConfirmar).toBeVisible({ timeout: 10_000 });
    await btnConfirmar.click();

    // 10. Etapa 5: Comprovante da reserva
    await expect(page.getByRole('heading', { name: /Seu Horário Está Garantido/i })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: test.info().outputPath('08_comprovante.png') });
  } finally {
    // Remove o cliente e o agendamento criados pelo teste
    await apagarClienteDeTeste(request, nomeCliente);
  }
});
