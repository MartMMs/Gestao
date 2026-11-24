import { test, expect } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, loginPelaTela, nomeClienteTeste } from './credenciais';

/**
 * Matriz de papéis (admin, supervisor, recepção, colaborador) das rotas e telas novas: cadastro e importação de
 * clientes, e-mail do cliente (LGPD), aviso de ficha, chave "exigir anamnese", serviços e botões da tela de clientes.
 * Turnos, folgas e bloqueios estão em folgas-rh.spec.ts; anamnese obrigatória em anamnese-obrigatoria.global.spec.ts.
 */
const GESTAO: string[] = [CONTAS.admin, CONTAS.supervisor];
const OPERACAO: string[] = [CONTAS.recepcao, CONTAS.colaboradora];

test.describe('Papéis — API', () => {
  test('clientes: recepção pode cadastrar mas não importar nem editar e-mail; colaborador não cadastra nem importa', async ({ request }) => {
    const nome = nomeClienteTeste('Papeis Cliente');
    const nomeRecepcao = nomeClienteTeste('Papeis Recepcao');
    try {
      // Colaborador não cadastra nem importa
      const colabHeaders = await authHeaders(request, CONTAS.colaboradora);
      expect((await request.post(`${apiBase()}/clientes`, { headers: colabHeaders, data: { nome } })).status(), 'colaboradora post').toBe(403);
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: colabHeaders, data: { linhas: [{ nome }] } })).status(), 'colaboradora importar').toBe(403);

      // Recepção pode cadastrar novo cliente (+ Novo cliente), mas continua bloqueada de importar planilha
      const recepcaoHeaders = await authHeaders(request, CONTAS.recepcao);
      const criadoRecepcao = await request.post(`${apiBase()}/clientes`, { headers: recepcaoHeaders, data: { nome: nomeRecepcao, telefone: '11999990001' } });
      expect(criadoRecepcao.status(), await criadoRecepcao.text()).toBe(201);
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: recepcaoHeaders, data: { linhas: [{ nome }] } })).status(), 'recepcao importar').toBe(403);

      const criado = await request.post(`${apiBase()}/clientes`, { headers: await authHeaders(request, CONTAS.supervisor), data: { nome, email: 'papeis@teste.com' } });
      expect(criado.status(), await criado.text()).toBe(201);
      const { id } = await criado.json();
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: await authHeaders(request, CONTAS.admin), data: { linhas: [{ nome: `${nome} Previa` }] } })).status()).toBe(200);

      for (const conta of [...GESTAO, ...OPERACAO]) {
        const lista = (await (await request.get(`${apiBase()}/clientes`, { headers: await authHeaders(request, conta) })).json()) as Array<{ id: string; email?: string | null; temAnamnese?: boolean }>;
        const cliente = lista.find((c) => c.id === id);
        // O colaborador só vê clientes que atende: este (sem atendimento) não aparece para ele
        if (conta === CONTAS.colaboradora) {
          expect(cliente, conta).toBeUndefined();
          continue;
        }
        expect(cliente?.temAnamnese, conta).toBe(false);
        expect(cliente?.email ?? null, conta).toBe(GESTAO.includes(conta) ? 'papeis@teste.com' : null);
      }
      // Edição do e-mail: só a supervisão (a recepção não altera dados cadastrais sensíveis como e-mail)
      expect((await request.put(`${apiBase()}/clientes/${id}`, { headers: recepcaoHeaders, data: { email: 'outro@teste.com' } })).status()).toBe(403);
    } finally {
      await apagarClienteDeTeste(request, nome);
      await apagarClienteDeTeste(request, nomeRecepcao);
    }
  });

  test('configuração "exigir anamnese": só supervisão e administração alteram', async ({ request }) => {
    // Sempre grava false (o valor de fora do projeto configuracao-global): não muda nada para os outros testes
    for (const conta of OPERACAO) {
      expect((await request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, conta), data: { exigirAnamnese: false } })).status(), conta).toBe(403);
    }
    for (const conta of GESTAO) {
      expect((await request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, conta), data: { exigirAnamnese: false } })).status(), conta).toBe(200);
    }
  });

  test('serviços: só supervisão e administração criam; profissional que não está na equipe é recusado', async ({ request }) => {
    const nome = `Papeis Servico ${Date.now() % 100000}`;
    const base = { nome, preco: 50, duracao: 30 };
    for (const conta of OPERACAO) {
      expect((await request.post(`${apiBase()}/servicos`, { headers: await authHeaders(request, conta), data: base })).status(), conta).toBe(403);
    }
    const sup = await authHeaders(request, CONTAS.supervisor);
    const fantasma = await request.post(`${apiBase()}/servicos`, { headers: sup, data: { ...base, modoElegibilidade: 'profissional', profissionaisPermitidos: ['Fulano Que Nao Existe'] } });
    expect(fantasma.status()).toBe(400);
    expect((await fantasma.json()).erro).toMatch(/não está na equipe/);

    const criado = await request.post(`${apiBase()}/servicos`, { headers: sup, data: { ...base, modoElegibilidade: 'profissional', profissionaisPermitidos: ['Helena E2E'] } });
    expect(criado.status(), await criado.text()).toBe(201);
    const servico = await criado.json();
    try {
      // Edição que mantém a lista gravada passa; incluir alguém de fora não
      expect((await request.put(`${apiBase()}/servicos/${servico.id}`, { headers: sup, data: { ...base, preco: 60, modoElegibilidade: 'profissional', profissionaisPermitidos: ['Helena E2E'] } })).status()).toBe(200);
      expect((await request.put(`${apiBase()}/servicos/${servico.id}`, { headers: sup, data: { ...base, modoElegibilidade: 'profissional', profissionaisPermitidos: ['Helena E2E', 'Outro Fantasma'] } })).status()).toBe(400);
    } finally {
      await request.delete(`${apiBase()}/servicos/${servico.id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});

test.describe('Papéis — tela de clientes', () => {
  test('recepção vê "+ Novo cliente" e não vê "Importar planilha"', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.recepcao);
    await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Base de Clientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Novo cliente/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Importar planilha' })).toHaveCount(0);
  });

  test('colaborador: sem "Novo cliente" e sem "Importar planilha"', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.colaboradora);
    await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Base de Clientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Novo cliente/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Importar planilha' })).toHaveCount(0);
  });

  for (const conta of GESTAO) {
    test(`${conta}: com "Novo cliente" e "Importar planilha"`, async ({ page }) => {
      await page.goto('/');
      await loginPelaTela(page, conta);
      // A administração abre no painel dela; a aba de clientes existe nos dois painéis
      await page.getByRole('button', { name: /Clientes$/ }).first().click();
      await expect(page.getByRole('button', { name: 'Novo cliente' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Importar planilha' })).toBeVisible();
    });
  }
});
