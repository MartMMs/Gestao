import { test, expect } from '@playwright/test';
import { CONTAS, apagarColaboradorDeTeste, apiBase, authHeaders, loginPelaTela } from './credenciais';

/**
 * Modal aberto bloqueia a página de fundo (clique no cabeçalho e rolagem) e fecha com Esc; e o cadastro de
 * profissional pela tela grava a conta, inclusive com e-mail digitado à mão.
 */
test.describe('Modais e cadastro de profissional', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
    await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
  });

  test('modal cobre o cabeçalho, trava a rolagem e só pergunta antes de sair se algo mudou', async ({ page }) => {
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
    await expect(dialogo).toBeVisible();

    // O ponto no meio do cabeçalho tem que cair no fundo do modal, não num botão do cabeçalho
    const noCabecalho = await page.evaluate(() => {
      const header = document.querySelector('header')!.getBoundingClientRect();
      const el = document.elementFromPoint(header.left + header.width / 2, header.top + header.height / 2);
      return !!el?.closest('header');
    });
    expect(noCabecalho).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

    // Sem nada alterado, Esc fecha sem perguntar
    const perguntas: string[] = [];
    const registrar = (d: import('@playwright/test').Dialog) => { perguntas.push(d.message()); void d.dismiss(); };
    page.on('dialog', registrar);
    await dialogo.getByPlaceholder('Especialidade', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    expect(perguntas).toHaveLength(0);

    // Com um campo preenchido (ou um dia da semana alternado), Esc e clique fora perguntam: "Cancelar" mantém aberto
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    await dialogo.getByRole('button', { name: 'DOM', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeVisible();
    expect(perguntas).toEqual([expect.stringMatching(/quer mesmo sair/)]);
    page.off('dialog', registrar);
    page.once('dialog', (d) => void d.accept());
    await page.mouse.click(5, 5);
    await expect(dialogo).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  });

  test('X, Esc e clique fora fazem o mesmo: perguntam só com algo preenchido (digitar e apagar não conta)', async ({ page }) => {
    const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
    const perguntas: string[] = [];
    page.on('dialog', (d) => { perguntas.push(d.message()); void d.dismiss(); });

    // Preenchido pelo fill (sem tecla nem clique): a comparação vem do estado, não de uma foto da tela
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    await dialogo.getByPlaceholder('Especialidade', { exact: true }).fill('Massagem');
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialogo).toBeVisible();
    expect(perguntas).toHaveLength(1);

    // Desfeito: volta a "não mudou" e o X fecha sem perguntar
    await dialogo.getByPlaceholder('Especialidade', { exact: true }).fill('');
    await dialogo.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialogo).toBeHidden();
    expect(perguntas).toHaveLength(1);
  });

  test('e-mail sugerido pode ser apagado (não volta sozinho) e vazio é recusado', async ({ page }) => {
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
    await dialogo.getByPlaceholder('Nome', { exact: true }).fill('Fulana Sugestao');
    const email = dialogo.getByPlaceholder('E-mail');
    await expect(email).toHaveValue(/fulana\.sugestao@/);
    await email.fill('');
    await expect(email).toHaveValue('');
    await dialogo.getByPlaceholder('Especialidade', { exact: true }).fill('Massagem');
    await dialogo.getByRole('button', { name: /Cadastrar/i }).click();
    await expect(page.getByText('Informe o e-mail do colaborador.')).toBeVisible();
  });

  test('cadastra profissional com e-mail digitado', async ({ page, request }) => {
    const sufixo = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const email = `tela.${sufixo}@teste.com`;
    try {
      await page.getByRole('button', { name: /Criar Usuário/i }).click();
      const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
      await dialogo.getByPlaceholder('Nome', { exact: true }).fill(`Tela Cadastro ${sufixo}`);
      await dialogo.getByPlaceholder('E-mail').fill(email);
      await dialogo.getByPlaceholder('Especialidade', { exact: true }).fill('Massagem');
      await dialogo.getByRole('button', { name: /Cadastrar/i }).click();
      await expect(page.getByText(email).first()).toBeVisible();
      const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ email: string }>;
      expect(equipe.some((c) => c.email === email)).toBe(true);
    } finally {
      await apagarColaboradorDeTeste(request, email);
    }
  });
});

test.describe('Novo Agendamento: Esc da busca de cliente e da ficha', () => {
  test('Esc fecha primeiro o aviso "Nenhum cliente encontrado", depois o modal; Esc da ficha não fecha o agendamento', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.colaboradora);
    await page.getByRole('button', { name: /Agendar/i }).click();
    const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
    const busca = modal.getByPlaceholder('Digite nome, telefone ou CPF');

    await busca.fill('zzqxw nada');
    await expect(modal.getByText('Nenhum cliente encontrado para essa busca.')).toBeVisible();
    await busca.press('Escape');
    await expect(modal.getByText('Nenhum cliente encontrado para essa busca.')).toBeHidden();
    await expect(modal).toBeVisible();

    // Ficha por cima: o Esc fecha só ela
    await modal.getByRole('button', { name: /Novo Cliente/i }).click();
    await modal.getByPlaceholder('Nome completo').fill('Cliente Esc Teste');
    await modal.getByRole('button', { name: /E2E Massagem/ }).first().click();
    await modal.getByRole('button', { name: /Ficha do Cliente/ }).click();
    const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese' });
    await expect(ficha).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ficha).toBeHidden();
    await expect(modal).toBeVisible();

    // Lista fechada: o Esc chega ao modal (que pergunta, porque há dados preenchidos)
    page.once('dialog', (d) => void d.accept());
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });
});

