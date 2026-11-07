import { test, expect } from '@playwright/test';
import { apagarClienteDeTeste, apiBase, authHeaders, CONTAS, diaFuturo, gerarCpfValido, loginPelaTela, nomeClienteTeste } from './credenciais';

/**
 * Cadastro manual de cliente e importação por planilha: só a supervisão, validação linha a linha, prévia dos erros
 * e gravação tudo-ou-nada.
 */

test.describe('Clientes — cadastro e importação', () => {
  test('API: cadastro manual valida e recusa duplicado; colaborador não cadastra', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const colaboradora = await authHeaders(request, CONTAS.colaboradora);
    const nome = nomeClienteTeste('Manual');
    const cpf = gerarCpfValido();
    try {
      expect((await request.post(`${apiBase()}/clientes`, { headers: colaboradora, data: { nome } })).status()).toBe(403);
      expect((await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome: '<b>x</b>' } })).status()).toBe(400);
      expect((await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome, email: 'nao-e-email' } })).status()).toBe(400);

      const criado = await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome, cpf, telefone: '(11) 98765-4321', email: 'Teste@Exemplo.com' } });
      expect(criado.status(), await criado.text()).toBe(201);
      expect(await criado.json()).toMatchObject({ nome, cpf, telefone: '11987654321', email: 'teste@exemplo.com' });

      expect((await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome: nome.toUpperCase() } })).status()).toBe(409);
      expect((await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome: nomeClienteTeste('Outro'), cpf } })).status()).toBe(409);

      // O colaborador não recebe o e-mail do cliente (LGPD)
      const vistos = (await (await request.get(`${apiBase()}/clientes`, { headers: colaboradora })).json()) as Array<{ email?: string | null }>;
      expect(vistos.every((c) => !c.email)).toBe(true);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('API: nome com HTML ou fórmula é recusado em todos os caminhos e papéis; número no nome é aceito', async ({ request }) => {
    const sup = await authHeaders(request, CONTAS.supervisor);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: sup })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = equipe.find((c) => c.email === CONTAS.colaboradora)!.id;
    const valido = `${nomeClienteTeste('Numero')} 2`;
    try {
      // Cliente novo pelo agendamento: recepção, supervisão e a própria colaboradora (para si)
      for (const conta of [CONTAS.recepcao, CONTAS.supervisor, CONTAS.colaboradora]) {
        for (const nomeRuim of ['<b>x</b>', '=HYPERLINK("x")', '@SUM(A1)']) {
          const headers = await authHeaders(request, conta);
          // Folga ou agenda ocupada da Helena dá 409 antes da regra do nome: procura um dia livre
          let r;
          for (let dias = 90; dias < 105; dias += 1) {
            r = await request.post(`${apiBase()}/agendamentos`, {
              headers, data: { collaboratorId: helenaId, date: diaFuturo(dias), time: '09:00', serviceNames: ['E2E Massagem'], clientName: nomeRuim },
            });
            if (r.status() !== 409) break;
          }
          expect(r!.status(), `${conta} ${nomeRuim}: ${await r!.text()}`).toBe(400);
        }
      }
      // Edição do cadastro: só supervisão altera nome
      const criado = await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome: valido } });
      expect(criado.status(), await criado.text()).toBe(201);
      const { id } = await criado.json();
      expect((await request.put(`${apiBase()}/clientes/${id}`, { headers: sup, data: { nome: '=CMD()' } })).status()).toBe(400);
      expect((await request.put(`${apiBase()}/clientes/${id}`, { headers: sup, data: { nome: '<img src=x>' } })).status()).toBe(400);
      // Mesmo nome com o sufixo atual não é revalidado (o totem grava "(tel. final 22)"): editar o telefone passa
      expect((await request.put(`${apiBase()}/clientes/${id}`, { headers: sup, data: { nome: valido, telefone: '(11) 98765-4321' } })).status()).toBe(200);
    } finally {
      await apagarClienteDeTeste(request, valido);
    }
  });

  test('API: importação mostra a prévia e só grava sem erros, tudo ou nada', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const a = nomeClienteTeste('Lote');
    const b = nomeClienteTeste('Lote');
    try {
      const comErro = [{ nome: a }, { nome: '=CMD()' }, { nome: b, cpf: '123' }];
      const previa = await request.post(`${apiBase()}/clientes/importar`, { headers: admin, data: { linhas: comErro, confirmar: false } });
      expect(await previa.json()).toEqual({
        total: 3, validos: 1, ignoradas: 0,
        erros: [
          { linha: 3, mensagem: expect.stringMatching(/começar com uma letra/) },
          { linha: 4, mensagem: expect.stringMatching(/CPF inválido/) },
        ],
      });
      const recusada = await request.post(`${apiBase()}/clientes/importar`, { headers: admin, data: { linhas: comErro, confirmar: true } });
      expect(recusada.status()).toBe(422);
      const base = (await (await request.get(`${apiBase()}/clientes`, { headers: admin })).json()) as Array<{ nome: string }>;
      expect(base.some((c) => c.nome === a)).toBe(false); // nada gravado

      const ok = await request.post(`${apiBase()}/clientes/importar`, { headers: admin, data: { linhas: [{ nome: a }, { nome: b }], confirmar: true } });
      expect(ok.status(), await ok.text()).toBe(201);
      expect((await ok.json()).importados).toBe(2);
      // Importar de novo: os dois já existem
      const repetida = await request.post(`${apiBase()}/clientes/importar`, { headers: admin, data: { linhas: [{ nome: a }], confirmar: false } });
      expect((await repetida.json()).erros[0].mensagem).toMatch(/Já existe cliente/);
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: await authHeaders(request, CONTAS.colaboradora), data: { linhas: [{ nome: a }] } })).status()).toBe(403);
    } finally {
      await apagarClienteDeTeste(request, [a, b]);
    }
  });

  test('tela: novo cliente e importação de CSV com prévia', async ({ page, request }) => {
    const manual = nomeClienteTeste('Tela');
    const c1 = nomeClienteTeste('Csv');
    const c2 = nomeClienteTeste('Csv');
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();

      await page.getByRole('button', { name: 'Novo cliente' }).click();
      const novo = page.getByRole('dialog', { name: 'Novo cliente' });
      await novo.getByLabel('Nome completo').fill(manual);
      await novo.getByLabel(/E-mail/).fill('manual@teste.com');
      await novo.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(novo).toBeHidden();
      await page.getByLabel('Buscar cliente').fill(manual);
      await expect(page.getByRole('cell', { name: new RegExp(manual) })).toBeVisible();

      await page.getByRole('button', { name: 'Importar planilha' }).click();
      const dialogo = page.getByRole('dialog', { name: 'Importar clientes' });
      const arquivo = dialogo.getByLabel('Planilha');

      // Tipo errado: recusado antes de ir à API
      await arquivo.setInputFiles({ name: 'clientes.xlsx', mimeType: 'text/html', buffer: Buffer.from('<html>') });
      await expect(dialogo.getByRole('alert')).toContainText('não confere');

      // CSV com erro: prévia mostra a linha e não deixa importar
      await arquivo.setInputFiles({ name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(`Nome;CPF\n${c1};\n<script>;\n`) });
      // A linha 3 (<script>) aparece com o erro do nome, na tabela de erros da prévia
      await expect(dialogo.getByRole('row').filter({ hasText: 'começar com uma letra' }).getByRole('cell', { name: '3', exact: true })).toBeVisible();
      await expect(dialogo.getByRole('button', { name: /^Importar/ })).toBeDisabled();

      // CSV correto
      await arquivo.setInputFiles({ name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from(`Nome;Celular\n${c1};(21) 99876-5432\n${c2};\n`) });
      await dialogo.getByRole('button', { name: 'Importar 2 cliente(s)' }).click();
      await expect(dialogo).toBeHidden();
      await page.getByLabel('Buscar cliente').fill(c2);
      await expect(page.getByRole('cell', { name: new RegExp(c2) })).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, [manual, c1, c2]);
    }
  });

  test('tela: importação de .xlsx real (telefone e CPF como número na célula)', async ({ page, request }) => {
    // Gerado pelo LibreOffice a partir de um CSV: os números ficam como células numéricas
    const nomes = ['Planilha Xlsx Alfa', 'Planilha Xlsx Beta'];
    await apagarClienteDeTeste(request, nomes);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await page.getByRole('button', { name: 'Importar planilha' }).click();
      const dialogo = page.getByRole('dialog', { name: 'Importar clientes' });
      await dialogo.getByLabel('Planilha').setInputFiles('e2e/fixtures/clientes-teste.xlsx');
      await dialogo.getByRole('button', { name: 'Importar 2 cliente(s)' }).click();
      await expect(dialogo).toBeHidden();

      const admin = await authHeaders(request, CONTAS.admin);
      const base = (await (await request.get(`${apiBase()}/clientes`, { headers: admin })).json()) as Array<{ nome: string; telefone: string | null; cpf: string | null; email: string | null }>;
      expect(base.find((c) => c.nome === nomes[0])).toMatchObject({ telefone: '11987654321', cpf: '52998224725', email: 'alfa@teste.com' });
      expect(base.find((c) => c.nome === nomes[1])).toMatchObject({ telefone: '2134567890', cpf: null });
    } finally {
      await apagarClienteDeTeste(request, nomes);
    }
  });

  test('tela: Esc na ficha de um cliente salvo descarta (pergunta antes) e só "Concluir" grava', async ({ page, request }) => {
    const nome = nomeClienteTeste('Ficha Esc');
    const sup = await authHeaders(request, CONTAS.supervisor);
    const criado = await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome, observacao: '__ANAMNESE_JSON__:{"alergia":"Lavanda"}' } });
    expect(criado.status(), await criado.text()).toBe(201);
    const { id } = await criado.json();
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await page.getByLabel('Buscar cliente').fill(nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByTitle('Ver ficha de anamnese').click();
      await page.getByRole('button', { name: 'Alterar Ficha' }).click();
      const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese' });
      const alergia = ficha.locator('label:has-text("Tem alguma alergia?") + input');
      await expect(alergia).toHaveValue('Lavanda');
      await alergia.fill('Mudou sem querer');

      page.once('dialog', (d) => { expect(d.message()).toMatch(/quer mesmo sair/); void d.accept(); });
      await page.keyboard.press('Escape');
      await expect(ficha).toBeHidden();
      const lista = (await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; observacao: string | null }>;
      expect(lista.find((c) => c.id === id)?.observacao).toContain('Lavanda');
      expect(lista.find((c) => c.id === id)?.observacao).not.toContain('Mudou sem querer');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});

