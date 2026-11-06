import { test, expect } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, loginPelaTela, postLogin } from './credenciais';

/**
 * Formulário de serviço em três grupos (dados básicos, preço e tempo, quem pode atender): campos achados pelo rótulo
 * (o leitor de tela anuncia), total na agenda calculado e edição a partir do card.
 */
test('serviço: cria pelo formulário agrupado e edita a partir do card', async ({ page, request }) => {
  const nome = `Servico Form ${Date.now() % 100000}`;
  await page.goto('/');
  await loginPelaTela(page, CONTAS.admin);
  await page.getByRole('button', { name: /Serviços$/ }).click();

  const form = page.getByRole('region', { name: 'Novo serviço' });
  await expect(form.getByRole('group', { name: '1. Dados básicos' })).toBeVisible();
  await form.getByLabel(/^Nome/).fill(nome);
  await form.getByLabel('Categoria').fill('Avaliação');
  await form.getByLabel(/^Preço/).fill('120');
  await form.getByLabel(/^Duração/).fill('50');
  await form.getByLabel(/^Preparo/).fill('10');
  await expect(form).toContainText('Ocupa a agenda por');
  await form.getByLabel('Regra').selectOption('cargo');
  await expect(form.getByLabel(/^Cargos/)).toBeVisible();
  await form.getByLabel('Regra').selectOption('livre');
  await form.getByRole('button', { name: 'Adicionar serviço' }).click();

  const card = page.getByRole('heading', { name: nome, level: 4 });
  await expect(card).toBeVisible();
  try {
    await card.click();
    const edicao = page.getByRole('region', { name: 'Editar serviço' });
    await expect(edicao.getByLabel(/^Nome/)).toHaveValue(nome);
    await expect(edicao.getByLabel(/^Nome/)).toBeFocused();
    await expect(edicao.getByLabel(/^Preço/)).toHaveValue('120');
    await edicao.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByRole('region', { name: 'Novo serviço' })).toBeVisible();
  } finally {
    const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
    const headers = { Authorization: `Bearer ${(await login.json()).token}` };
    const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers })).json()) as Array<{ id: string; nome: string }>;
    const criado = servicos.find((s) => s.nome === nome);
    if (criado) await request.delete(`${apiBase()}/servicos/${criado.id}`, { headers });
  }
});
