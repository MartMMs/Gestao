import { test, expect, type Page } from '@playwright/test';
import { CONTAS, E2E_PASSWORD, apiBase, loginPelaTela, postLogin } from './credenciais';

/**
 * Edição do agendamento pela supervisão: digitar o nome de outro cadastro passa o atendimento para ele, e um nome
 * que não existe renomeia a ficha. As duas coisas só gravam depois de confirmar (antes, renomeavam em silêncio).
 */
const letras = () => `${Date.now()}${Math.floor(Math.random() * 1e4)}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);

// Abre na grade o dia do atendimento, pela visão Mês (a grade abre em hoje)
async function abrirDia(page: Page, dia: string) {
  await page.getByRole('button', { name: /^Agenda$/i }).click();
  await page.getByRole('button', { name: 'Mês', exact: true }).click();
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  if (dia.slice(0, 7) !== hoje.slice(0, 7)) await page.getByRole('button', { name: 'Próximo mês' }).click();
  // A grade do mês também mostra dias do mês vizinho: o do teste é o que já tem atendimentos
  await page.getByRole('button', { name: new RegExp(`^${Number(dia.slice(8))}: \\d+ atendimentos?\\. Abrir na grade$`) }).first().click();
}

test('supervisão: passar o atendimento para outro cadastro e renomear pedem confirmação', async ({ page, request }) => {
  const login = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  const headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers })).json()) as Array<{ id: string; email?: string }>;
  const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
  test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');

  const marca = letras();
  const duplicado = `Banca Junta ${marca} Dois`;
  const verdadeiro = `Banca Junta ${marca}`;
  // Amanhã (a grade de hoje pode já ter passado do horário), num horário livre
  const dia = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const criar = async (clientName: string) => {
    for (let h = 9; h < 20; h++) {
      const r = await request.post(`${apiBase()}/agendamentos`, {
        headers, data: { collaboratorId: helena!.id, date: dia, time: `${String(h).padStart(2, '0')}:00`, serviceNames: ['E2E Massagem'], clientName },
      });
      if (r.status() === 201) return r.json() as Promise<{ id: string; clienteId: string; atualizadoEm: string }>;
    }
    throw new Error('Nenhum horário livre amanhã para a colaboradora de teste.');
  };
  const ag = await criar(duplicado);
  const outro = await criar(verdadeiro);
  const clientes = new Set([ag.clienteId, outro.clienteId]);
  try {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await abrirDia(page, dia);
    const editar = (nome: string) => page.getByRole('button', { name: `Editar o atendimento de ${nome}`, exact: true }).first().click();
    const campoCliente = page.locator('input[list="edit-appointment-clientes"]');

    // Nome de outro cadastro: confirma antes; cancelar não grava
    await editar(duplicado);
    await campoCliente.fill(verdadeiro);
    await page.getByRole('button', { name: /Salvar Alterações/i }).click();
    const passar = page.getByRole('dialog', { name: 'Passar o atendimento para outro cadastro?' });
    await expect(passar).toBeVisible();
    await passar.getByRole('button', { name: 'Cancelar' }).click();
    const antes = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${ag.clienteId}`, { headers })).json()) as Array<{ id: string }>;
    expect(antes.some((a) => a.id === ag.id)).toBe(true);

    // Confirmar: o atendimento passa para o cadastro existente, sem renomear nenhum dos dois
    await page.getByRole('button', { name: /Salvar Alterações/i }).click();
    await passar.getByRole('button', { name: 'Passar para esse cadastro' }).click();
    await expect(page.getByText(new RegExp(`Atendimento passado para o cadastro de ${verdadeiro}`))).toBeVisible();
    const doVerdadeiro = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${outro.clienteId}`, { headers })).json()) as Array<{ id: string }>;
    expect(doVerdadeiro.map((a) => a.id)).toContain(ag.id);

    // Nome que não é de ninguém: renomearia a ficha (de todos os atendimentos dela), então confirma; cancelar não grava
    await editar(verdadeiro);
    await campoCliente.fill(`${verdadeiro} Quase`);
    await page.getByRole('button', { name: /Salvar Alterações/i }).click();
    const renomear = page.getByRole('dialog', { name: 'Renomear o cadastro do cliente?' });
    await expect(renomear).toBeVisible();
    await renomear.getByRole('button', { name: 'Cancelar' }).click();
    const fichas = (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>;
    expect(fichas.find((c) => c.id === outro.clienteId)?.nome).toBe(verdadeiro);
  } finally {
    for (const clienteId of clientes) {
      const ags = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${clienteId}`, { headers })).json()) as Array<{ id: string; atualizadoEm: string }>;
      for (const a of ags) await request.delete(`${apiBase()}/agendamentos/${a.id}`, { headers, data: { version: a.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${clienteId}`, { headers });
    }
  }
});

// O Sair limpa os dados da conta anterior; limpar também na entrada deixava a tela presa em "Carregando"
test('entrar, sair e entrar com outra conta na mesma aba: o portal sempre carrega', async ({ page }) => {
  const portalColaborador = page.getByRole('heading', { name: /Portal do Colaborador/i });
  await page.goto('/');
  await loginPelaTela(page, CONTAS.colaboradora);
  await expect(portalColaborador).toBeVisible({ timeout: 20_000 });
  await page.getByTitle('Sair').click();
  await loginPelaTela(page, CONTAS.supervisor);
  await expect(page.getByRole('heading', { name: /Portal d[oa] Supervis(or|[aã]o)/i })).toBeVisible({ timeout: 20_000 });
  await page.getByTitle('Sair').click();
  await loginPelaTela(page, CONTAS.colaboradora);
  await expect(portalColaborador).toBeVisible({ timeout: 20_000 });
});
