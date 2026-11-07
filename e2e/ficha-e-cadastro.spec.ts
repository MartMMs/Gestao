import { test, expect } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, loginPelaTela, nomeClienteTeste } from './credenciais';

test.describe('Ficha no agendamento e cadastro de usuário', () => {
  test('Admin: erro do "Cadastrar" aparece por cima do formulário (antes ia para um toast escondido)', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.admin);
    await page.getByRole('button', { name: /Equipe & Papéis/i }).click();
    await page.getByRole('button', { name: /Criar Usuário/i }).click();
    const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
    // Nome curto: a API recusa (a tela só confere se está vazio)
    await dialogo.getByPlaceholder('Nome', { exact: true }).fill('Ab');
    await dialogo.getByLabel('Usuário de acesso').fill(`banca.${Date.now()}`);
    await dialogo.getByPlaceholder('Cargo (ex.: Massagista)').fill('Teste');
    await dialogo.getByRole('button', { name: 'Cadastrar' }).click();

    const alerta = page.getByRole('alert').filter({ hasText: 'Informe o nome completo do colaborador.' });
    await expect(alerta).toBeVisible();
    await expect(dialogo).toBeVisible();
    // Visível de fato: o centro do aviso não está coberto pelo fundo do modal
    const porCima = await alerta.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    expect(porCima).toBe(true);
  });

  test('agendamento: cliente com ficha abre a visualização, não o formulário vazio (recepção vê só o aviso)', async ({ page, request }) => {
    const nome = nomeClienteTeste('Ficha Ver');
    const sup = await authHeaders(request, CONTAS.supervisor);
    const criado = await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome, observacao: '__ANAMNESE_JSON__:{"alergia":"Lavanda"}' } });
    expect(criado.status(), await criado.text()).toBe(201);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: /Agendar/i }).click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByPlaceholder('Digite nome, telefone ou CPF').fill(nome);
      await modal.getByRole('button', { name: new RegExp(nome) }).first().click();
      await modal.getByRole('button', { name: 'Ver ficha', exact: true }).click();

      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(/já tem ficha registrada/)).toBeVisible();
      // Conteúdo de saúde escondido da recepção (LGPD), mas com botão "Atualizar ficha" para recadastro no balcão
      await expect(resumo.getByText(/Lavanda/i)).toHaveCount(0);
      await expect(resumo.getByRole('button', { name: 'Atualizar ficha' })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true })).toHaveCount(0);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});
