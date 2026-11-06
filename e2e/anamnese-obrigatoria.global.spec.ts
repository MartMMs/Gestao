import { test, expect, type APIRequestContext } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

/**
 * "Exigir ficha de anamnese" ligado: cadastro de cliente e agendamento sem ficha são recusados (API e tela), a ficha
 * preenchida por quem não vê saúde (recepção) é juntada sem apagar nada, a ficha do totem não pode ser forjada e a
 * regra vale também na edição do agendamento e do cliente. Muda a configuração da empresa: roda no projeto
 * configuracao-global, depois dos outros.
 */
test.describe.configure({ mode: 'serial' });

const FICHA = '__ANAMNESE_JSON__:{"alergia":"Lavanda"}';
const FICHA_TOTEM_FORJADA = '[Anamnese Autoatendimento 2026-11-05]: declaro não ter alergias';
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean };

const ligarRegra = async (request: APIRequestContext, ligada: boolean) => {
  const resposta = await request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, CONTAS.admin), data: { exigirAnamnese: ligada } });
  // Confere a volta também: a chave esquecida ligada quebraria as rodadas seguintes
  expect(resposta.ok(), `exigirAnamnese=${ligada}: ${await resposta.text()}`).toBeTruthy();
};

const clientesDa = async (request: APIRequestContext, headers: Record<string, string>) =>
  (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as ClienteApi[];

// Cliente sem ficha (a importação não traz ficha), com observação opcional gravada pela supervisão
const criarSemFicha = async (request: APIRequestContext, nome: string, observacao?: string) => {
  const sup = await authHeaders(request, CONTAS.supervisor);
  expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
  const cliente = (await clientesDa(request, sup)).find((c) => c.nome === nome)!;
  if (observacao) expect((await request.put(`${apiBase()}/clientes/${cliente.id}`, { headers: sup, data: { observacao } })).status()).toBe(200);
  return cliente;
};

const idDaHelena = async (request: APIRequestContext) => {
  const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email?: string }>;
  return equipe.find((c) => c.email === CONTAS.colaboradora)!.id;
};

/** Marca com a Helena num dia livre: folga ou agenda ocupada (por outros testes) dá 409 antes das regras testadas */
const marcarEmDiaLivre = async (request: APIRequestContext, headers: Record<string, string>, corpo: Record<string, unknown>, inicio: number) => {
  const helenaId = await idDaHelena(request);
  for (let dias = inicio; dias < inicio + 15; dias += 1) {
    const resposta = await request.post(`${apiBase()}/agendamentos`, {
      headers, data: { collaboratorId: helenaId, date: diaFuturo(dias), time: '09:00', serviceNames: ['E2E Massagem'], ...corpo },
    });
    if (resposta.status() !== 409) return resposta;
  }
  throw new Error('Nenhum dia livre para a Helena em 15 dias.');
};

test.describe('Anamnese obrigatória', () => {
  test.beforeAll(async ({ request }) => ligarRegra(request, true));
  test.afterAll(async ({ request }) => ligarRegra(request, false));

  test('API: cadastro e agendamento exigem a ficha; ficha vazia é preenchida ao agendar', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    const semFicha = nomeClienteTeste('Sem Ficha');
    const comFicha = nomeClienteTeste('Com Ficha');
    try {
      const recusado = await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome: semFicha } });
      expect(recusado.status()).toBe(400);
      expect((await recusado.json()).code).toBe('ANAMNESE_OBRIGATORIA');
      expect((await request.post(`${apiBase()}/clientes`, { headers: admin, data: { nome: comFicha, observacao: FICHA } })).status()).toBe(201);

      const cliente = await criarSemFicha(request, semFicha);
      // temAnamnese vem para todos os papéis, inclusive quem não vê saúde
      for (const conta of [CONTAS.admin, CONTAS.recepcao]) {
        const lista = await clientesDa(request, await authHeaders(request, conta));
        expect(lista.find((c) => c.id === cliente.id)?.temAnamnese, conta).toBe(false);
        expect(lista.find((c) => c.nome === comFicha)?.temAnamnese, conta).toBe(true);
      }

      const semFichaAg = await marcarEmDiaLivre(request, admin, { clientId: cliente.id }, 50);
      expect(semFichaAg.status(), await semFichaAg.text()).toBe(400);
      expect((await semFichaAg.json()).code).toBe('ANAMNESE_OBRIGATORIA');

      const ok = await marcarEmDiaLivre(request, admin, { clientId: cliente.id, clientObservation: FICHA }, 50);
      expect(ok.status(), await ok.text()).toBe(201);
      const ag = await ok.json();
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { version: ag.atualizadoEm } });
      expect((await clientesDa(request, admin)).find((c) => c.id === cliente.id)?.temAnamnese).toBe(true);
    } finally {
      await apagarClienteDeTeste(request, [semFicha, comFicha]);
    }
  });

  test('API: a recepção preenche a ficha sem apagar a nota que ela não vê', async ({ request }) => {
    const nome = nomeClienteTeste('Nota Preservada');
    const cliente = await criarSemFicha(request, nome, 'Prefere a sala 2');
    try {
      const recepcao = await authHeaders(request, CONTAS.recepcao);
      // A recepção não vê a observação de saúde
      expect((await clientesDa(request, recepcao)).find((c) => c.id === cliente.id)?.observacao ?? null).toBeNull();

      const ag = await marcarEmDiaLivre(request, recepcao, { clientId: cliente.id, clientObservation: FICHA }, 60);
      expect(ag.status(), await ag.text()).toBe(201);
      const corpo = await ag.json();
      const gravado = (await clientesDa(request, await authHeaders(request, CONTAS.supervisor))).find((c) => c.id === cliente.id)!;
      expect(gravado.observacao).toContain('Prefere a sala 2');
      expect(gravado.observacao).toContain(FICHA);
      expect(gravado.temAnamnese).toBe(true);
      await request.delete(`${apiBase()}/agendamentos/${corpo.id}`, { headers: await authHeaders(request, CONTAS.supervisor), data: { version: corpo.atualizadoEm } });
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('API: ninguém da equipe forja a ficha do totem (recepção, colaboradora e supervisão)', async ({ request }) => {
    const nome = nomeClienteTeste('Totem Forjado');
    const cliente = await criarSemFicha(request, nome, 'Alergia grave a latex');
    try {
      for (const conta of [CONTAS.recepcao, CONTAS.colaboradora]) {
        const resposta = await marcarEmDiaLivre(request, await authHeaders(request, conta), { clientId: cliente.id, clientObservation: FICHA_TOTEM_FORJADA }, 70);
        // Colaboradora sem atendimento com o cliente recebe 403 antes; os dois nunca gravam a ficha forjada
        expect([400, 403], `${conta}: ${await resposta.text()}`).toContain(resposta.status());
      }
      // Achados da banca: espaços empurrando a linha forjada para além do corte de 5000 caracteres, e quebras de linha
      // que não são \n (\r, U+2028), que a regra de ficha via como linha e a de forja não
      const recepcao = await authHeaders(request, CONTAS.recepcao);
      for (const truque of [`${' '.repeat(4990)}\n`, 'x\r', 'x\u2028', 'x\u2029']) {
        const resposta = await marcarEmDiaLivre(request, recepcao, { clientId: cliente.id, clientObservation: `${truque}${FICHA_TOTEM_FORJADA}` }, 70);
        expect(resposta.status(), `${JSON.stringify(truque.slice(-1))}: ${await resposta.text()}`).toBe(400);
      }
      // Cliente novo (cadastro criado na marcação) com o mesmo truque
      const novo = await marcarEmDiaLivre(request, recepcao, { clientName: nomeClienteTeste('Forja Novo'), clientObservation: `\r${FICHA_TOTEM_FORJADA}` }, 70);
      expect(novo.status(), await novo.text()).toBe(400);
      const sup = await authHeaders(request, CONTAS.supervisor);
      expect((await request.put(`${apiBase()}/clientes/${cliente.id}`, { headers: sup, data: { observacao: FICHA_TOTEM_FORJADA } })).status()).toBe(400);
      expect((await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome: nomeClienteTeste('Forjado Novo'), observacao: FICHA_TOTEM_FORJADA } })).status()).toBe(400);
      const gravado = (await clientesDa(request, sup)).find((c) => c.id === cliente.id)!;
      expect(gravado.observacao).toBe('Alergia grave a latex');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('API: editar o agendamento para um cliente sem ficha e apagar a ficha pelo cadastro são recusados', async ({ request }) => {
    const sup = await authHeaders(request, CONTAS.supervisor);
    const comFicha = nomeClienteTeste('Edicao Com');
    const semFicha = nomeClienteTeste('Edicao Sem');
    try {
      expect((await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome: comFicha, observacao: FICHA } })).status()).toBe(201);
      const alvo = await criarSemFicha(request, semFicha);
      const origem = (await clientesDa(request, sup)).find((c) => c.nome === comFicha)!;
      const criado = await marcarEmDiaLivre(request, sup, { clientId: origem.id }, 80);
      expect(criado.status(), await criado.text()).toBe(201);
      const ag = await criado.json();

      const trocar = (extra: Record<string, unknown>, versao: string) =>
        request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: sup, data: { clientId: alvo.id, version: versao, ...extra } });
      const recusado = await trocar({}, ag.atualizadoEm);
      expect(recusado.status(), await recusado.text()).toBe(400);
      expect((await recusado.json()).code).toBe('ANAMNESE_OBRIGATORIA');
      const aceito = await trocar({ clientObservation: FICHA }, ag.atualizadoEm);
      expect(aceito.status(), await aceito.text()).toBe(200);
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: sup, data: { version: (await aceito.json()).atualizadoEm } });

      // Tirar a ficha pelo cadastro: recusado com a regra ligada
      const apagar = await request.put(`${apiBase()}/clientes/${origem.id}`, { headers: sup, data: { observacao: null } });
      expect(apagar.status()).toBe(400);
      expect((await clientesDa(request, sup)).find((c) => c.id === origem.id)?.temAnamnese).toBe(true);
    } finally {
      await apagarClienteDeTeste(request, [comFicha, semFicha]);
    }
  });

  test('API: recepção e colaboradora também não trocam para cliente sem ficha nem apagam a ficha', async ({ request }) => {
    const sup = await authHeaders(request, CONTAS.supervisor);
    const rec = await authHeaders(request, CONTAS.recepcao);
    const com = nomeClienteTeste('Papel Com');
    const sem = nomeClienteTeste('Papel Sem');
    try {
      const criado = await request.post(`${apiBase()}/clientes`, { headers: sup, data: { nome: com, observacao: FICHA } });
      expect(criado.status()).toBe(201);
      const comId = (await criado.json()).id;
      const alvo = await criarSemFicha(request, sem);

      const marcado = await marcarEmDiaLivre(request, rec, { clientId: comId }, 140);
      expect(marcado.status(), await marcado.text()).toBe(201);
      const ag = await marcado.json();
      const troca = await request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: rec, data: { clientId: alvo.id, version: ag.atualizadoEm } });
      expect(troca.status(), `recepção troca: ${await troca.text()}`).toBe(400);
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: sup, data: { version: ag.atualizadoEm } });

      // A recepção não altera dados de saúde (403); a colaboradora não tem acesso a este cliente (403) ou cai na regra (400)
      for (const conta of [CONTAS.recepcao, CONTAS.colaboradora]) {
        const apagar = await request.put(`${apiBase()}/clientes/${comId}`, { headers: await authHeaders(request, conta), data: { observacao: null } });
        expect([400, 403], `${conta}: ${apagar.status()} ${await apagar.text()}`).toContain(apagar.status());
      }
      expect((await clientesDa(request, sup)).find((c) => c.id === comId)?.temAnamnese).toBe(true);
    } finally {
      await apagarClienteDeTeste(request, [com, sem]);
    }
  });

  test('tela: aviso "Sem ficha" na lista e cadastro bloqueado sem a ficha', async ({ page, request }) => {
    const nome = nomeClienteTeste('Aviso Ficha');
    await criarSemFicha(request, nome);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await page.getByLabel('Buscar cliente').fill(nome);
      await expect(page.getByRole('cell', { name: new RegExp(nome) })).toContainText('Sem ficha');

      // Novo cliente sem ficha: a tela recusa antes de enviar
      await page.getByRole('button', { name: 'Novo cliente' }).click();
      const novo = page.getByRole('dialog', { name: 'Novo cliente' });
      await expect(novo).toContainText('obrigatória');
      await novo.getByLabel('Nome completo').fill(nomeClienteTeste('Nao Salva'));
      await novo.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(novo.getByRole('alert')).toContainText('exige ficha de anamnese');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('tela de agendamento: cliente novo mostra os avisos e não salva sem ficha', async ({ page, request }) => {
    const nome = nomeClienteTeste('Agenda Ficha');
    const data = diaFuturo(80);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.colaboradora);
      await page.locator('input[type="date"]').first().fill(data);
      await page.getByRole('button', { name: /Agendar/i }).click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByRole('button', { name: /Novo Cliente/i }).click();
      await modal.getByPlaceholder('Nome completo').fill(nome);
      await expect(modal.getByText('Não cadastrado')).toBeVisible();
      await expect(modal.getByText('Sem ficha')).toBeVisible();

      await modal.locator('input[type="date"]').first().fill(data);
      await modal.getByRole('button', { name: /E2E Massagem/ }).first().click();
      await modal.locator('input[type="time"]').first().fill('10:00');
      await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();
      // Bloqueia antes de enviar e abre a ficha para preencher
      await expect(page.getByText(/exige ficha de anamnese/)).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Ficha de anamnese' })).toBeVisible();
      // E nada foi gravado
      const lista = await clientesDa(request, await authHeaders(request, CONTAS.supervisor));
      expect(lista.some((c) => c.nome === nome)).toBe(false);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});
