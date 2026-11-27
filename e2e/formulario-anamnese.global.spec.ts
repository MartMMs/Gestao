import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { codigoReserva } from '../shared/codigoReserva';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste, reservarHorarioNoTotem } from './credenciais';

// Formulário de anamnese configurável (Personalizar formulário). Global: muda as perguntas do totem para todos os
// testes, por isso roda em série depois dos outros e, no fim, devolve o formulário como estava (as perguntas criadas
// ficam arquivadas: campo nunca é apagado).
type Campo = { id: string; chave: string; rotulo: string; ajuda: string | null; canal: string; ativa: boolean; obrigatorio: boolean; [k: string]: unknown };
type Formulario = { campos: Campo[]; versao: number };

const sufixo = Math.random().toString(36).slice(2, 7);
const MULTIPLA = `Áreas com dor ${sufixo}`;
const OPCOES = ['Costas', 'Pescoço', `Joelho ${sufixo}`];
const OPCAO_ALERTA = `Joelho ${sufixo}`;
const PROF = `Nota técnica ${sufixo}`;
const OBS_NOVA = `Algo que a equipe deva saber? ${sufixo}`;
const AJUDA_NOVA = `Ex.: horário de chegada ${sufixo}`;
const OBRIGATORIA = 'Tem alguma alergia?';
// Prints da conferência visual: só com PRINTS_DIR (fora do repositório)
const print = async (page: Page, nome: string) => { if (process.env.PRINTS_DIR) await page.screenshot({ path: `${process.env.PRINTS_DIR}/${nome}.png`, fullPage: true }); };

let original: Formulario | null = null;
const lerFormulario = async (request: APIRequestContext) => {
  const r = await request.get(`${apiBase()}/formulario-anamnese`, { headers: await authHeaders(request, CONTAS.admin) });
  expect(r.status()).toBe(200);
  return (await r.json()) as Formulario;
};
// Volta os campos que existiam ao estado original e arquiva os criados aqui
const restaurar = async (request: APIRequestContext) => {
  if (!original) return;
  const atual = await lerFormulario(request);
  const antes = new Map(original.campos.map((c) => [c.id, c]));
  const campos = [...original.campos, ...atual.campos.filter((c) => !antes.has(c.id)).map((c) => ({ ...c, ativa: false }))];
  const r = await request.put(`${apiBase()}/formulario-anamnese`, { headers: await authHeaders(request, CONTAS.admin), data: { versao: atual.versao, campos } });
  expect(r.status(), await r.text()).toBe(200);
};

const card = (modal: Locator, rotulo: string | RegExp) => modal.getByRole('list', { name: 'Perguntas ativas' }).getByRole('listitem').filter({ hasText: rotulo });
const abrirCard = async (modal: Locator, rotulo: string | RegExp) => {
  await expect(card(modal, rotulo)).toBeVisible();
  const botao = card(modal, rotulo).locator('button[aria-expanded="false"]');
  if (await botao.count()) await botao.click();
};
const semCorteHorizontal = async (page: Page, seletor?: string) => {
  const medida = await page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) as HTMLElement : document.documentElement;
    return { scroll: el.scrollWidth, cliente: el.clientWidth };
  }, seletor);
  expect(medida.scroll, `corte horizontal em ${seletor ?? 'página'}`).toBeLessThanOrEqual(medida.cliente);
};

const abrirTotem = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Autoatendimento/i }).click();
  await expect(page.getByRole('heading', { name: /Catálogo/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Aromaterapia|Drenagem|Massagem/i }).first().click();
  await page.getByRole('button', { name: /Escolher Horário/i }).click();
  await reservarHorarioNoTotem(page);
};

test.describe('Formulário de anamnese configurável', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ request }) => { original = await lerFormulario(request); });
  test.afterAll(async ({ request }) => { await restaurar(request); });
  const nomeCliente = nomeClienteTeste('Formulario Dinamico');

  test('recepção e colaborador recebem 403 ao editar o formulário ou carregar modelo', async ({ request }) => {
    for (const conta of [CONTAS.recepcao, CONTAS.colaboradora]) {
      const headers = await authHeaders(request, conta);
      expect((await request.get(`${apiBase()}/formulario-anamnese`, { headers })).status()).toBe(403);
      expect((await request.put(`${apiBase()}/formulario-anamnese`, { headers, data: { campos: [], versao: 1 } })).status()).toBe(403);
      expect((await request.post(`${apiBase()}/formulario-anamnese/preset`, { headers, data: { aplicar: true } })).status()).toBe(403);
    }
  });

  test('cenário 1: supervisor edita pela aba Totem & Autoatendimento (frases, obrigatoriedade, múltipla escolha, campo do profissional)', async ({ page, request }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await page.getByRole('button', { name: 'Totem & Autoatendimento' }).click();
    await page.getByRole('button', { name: 'Personalizar formulário' }).click();
    const modal = page.getByRole('dialog', { name: 'Personalizar formulário de anamnese' });
    await expect(card(modal, OBRIGATORIA)).toBeVisible();

    // Frase e texto de apoio de uma pergunta do modelo; ela continua opcional
    await abrirCard(modal, /Alguma observação/);
    await card(modal, /Alguma observação/).getByLabel(/^Rótulo da pergunta/).fill(OBS_NOVA);
    await card(modal, OBS_NOVA).getByLabel(`Ajuda de ${OBS_NOVA}`).fill(AJUDA_NOVA);
    await card(modal, OBS_NOVA).getByRole('radio', { name: 'Opcional' }).click();
    await expect(card(modal, OBS_NOVA).getByText('Opcional', { exact: true }).first()).toBeVisible();

    // Alergia passa a ser obrigatória: o selo do card muda na hora
    await abrirCard(modal, OBRIGATORIA);
    await card(modal, OBRIGATORIA).getByRole('radio', { name: 'Obrigatório' }).click();
    await expect(card(modal, OBRIGATORIA).getByText('Obrigatório', { exact: true }).first()).toBeVisible();

    // Múltipla escolha com 3 opções (a 3ª pelo Enter) e alerta numa delas
    await modal.getByRole('button', { name: '+ Nova pergunta' }).click();
    const focado = page.locator(':focus');
    await expect(focado).toHaveAttribute('aria-label', /^Rótulo da pergunta/);
    await focado.fill(MULTIPLA);
    const multipla = card(modal, MULTIPLA);
    await multipla.getByLabel(`Tipo de ${MULTIPLA}`).selectOption('multipla_escolha');
    await multipla.getByLabel(`Opção 1 de ${MULTIPLA}`).fill(OPCOES[0]);
    await multipla.getByLabel(`Opção 2 de ${MULTIPLA}`).fill(OPCOES[1]);
    await multipla.getByLabel(`Nova opção de ${MULTIPLA}`).fill(OPCOES[2]);
    await multipla.getByLabel(`Nova opção de ${MULTIPLA}`).press('Enter');
    await expect(multipla.getByLabel(`Opção 3 de ${MULTIPLA}`)).toHaveValue(OPCOES[2]);
    // Opção repetida aparece como erro na hora; removê-la resolve
    await multipla.getByLabel(`Nova opção de ${MULTIPLA}`).fill('costas');
    await multipla.getByRole('button', { name: '+ Adicionar opção' }).click();
    await expect(multipla.getByRole('alert')).toContainText('Há opções repetidas.');
    await multipla.getByRole('button', { name: 'Remover opção costas', exact: true }).click();
    await expect(multipla.getByRole('alert')).toHaveCount(0);
    await multipla.getByRole('group', { name: `Gerar alerta visual para respostas de ${MULTIPLA}` }).getByLabel(OPCAO_ALERTA).check();
    await expect(multipla.getByText(`Alerta: ${OPCAO_ALERTA}`)).toBeVisible();

    // Texto livre só do profissional, obrigatório na ficha da equipe
    await modal.getByRole('button', { name: '+ Nova pergunta' }).click();
    await expect(focado).toHaveAttribute('aria-label', /^Rótulo da pergunta/);
    await focado.fill(PROF);
    await card(modal, PROF).getByLabel(`Tipo de ${PROF}`).selectOption('texto_livre');
    await card(modal, PROF).getByLabel(`Visibilidade de ${PROF}`).selectOption('apenas_profissional');
    await card(modal, PROF).getByRole('radio', { name: 'Obrigatório' }).click();
    await print(page, 'editor-desktop');

    // Prévias testáveis: tocar e digitar; o campo do profissional só na prévia do profissional
    await modal.getByRole('tab', { name: 'Prévia Totem' }).click();
    await expect(modal.getByText(MULTIPLA)).toBeVisible();
    await expect(modal.getByText(`${OBRIGATORIA} *`)).toBeVisible();
    await expect(modal.getByText(PROF)).toHaveCount(0);
    await modal.getByRole('button', { name: `${MULTIPLA}: ${OPCOES[0]}` }).click();
    await modal.getByRole('button', { name: `${MULTIPLA}: ${OPCAO_ALERTA}` }).click();
    await expect(modal.getByRole('button', { name: `${MULTIPLA}: ${OPCOES[0]}` })).toHaveAttribute('aria-pressed', 'true');
    await modal.getByLabel(OBS_NOVA).fill('teste na prévia');
    await print(page, 'previa-totem');
    await modal.getByRole('tab', { name: 'Prévia Profissional' }).click();
    await modal.getByLabel(`${PROF} *`).fill('digitando na prévia');
    await modal.getByRole('tab', { name: 'Editar' }).click();

    // Fechar com alteração pede confirmação; "Continuar editando" mantém tudo
    await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
    const sair = page.getByRole('dialog', { name: 'Descartar alterações?' });
    await expect(sair).toBeVisible();
    await sair.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(card(modal, MULTIPLA)).toBeVisible();

    await modal.getByRole('button', { name: 'Salvar formulário' }).click();
    await expect(modal.getByRole('status')).toContainText('Formulário salvo');

    const texto = await (await request.get(`${apiBase()}/autoatendimento/formulario`)).text();
    expect(texto).toContain(MULTIPLA);
    expect(texto).toContain(OBS_NOVA);
    expect(texto).not.toContain(PROF);
    expect(texto).not.toContain('respostasAlerta');
    const auditoria = await request.get(`${apiBase()}/auditoria`, { headers: await authHeaders(request, CONTAS.admin) });
    expect(await auditoria.text()).toContain('formulario.anamnese');
  });

  test('cenário 2: totem cobra a obrigatória, aceita a opcional em branco e grava a múltipla escolha com alerta', async ({ page, request }) => {
    test.setTimeout(150_000);
    await abrirTotem(page);
    await expect(page.getByText(MULTIPLA)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(AJUDA_NOVA)).toBeVisible();
    // Campo do profissional fora do DOM e da API pública
    expect(await page.content()).not.toContain(PROF);
    expect(await (await request.get(`${apiBase()}/autoatendimento/formulario`)).text()).not.toContain(PROF);

    await page.locator('input[placeholder*="Mariana" i]').fill(nomeCliente);
    await page.locator('input[placeholder*="98765" i]').fill('(11) 96543-2109');
    await page.getByRole('checkbox', { name: /Autorizo .* a usar meus dados pessoais/i }).check();
    const avancar = page.getByRole('button', { name: /Ir para Pagamento|Revisar e Confirmar/i });
    await avancar.click();
    await expect(page.getByRole('alert').filter({ hasText: `Responda: ${OBRIGATORIA}` })).toBeVisible();

    await page.getByRole('button', { name: `${OBRIGATORIA}: Não` }).click();
    await page.getByRole('button', { name: `${MULTIPLA}: ${OPCOES[0]}` }).click();
    await page.getByRole('button', { name: `${MULTIPLA}: ${OPCAO_ALERTA}` }).click();
    await print(page, 'totem-desktop');
    await avancar.click();
    await page.getByRole('button', { name: /Confirmar Agendamento/i }).click();
    await expect(page.getByRole('heading', { name: /Seu Horário Está Garantido/i })).toBeVisible({ timeout: 20_000 });
  });

  test('cenário 3: ficha da equipe sem perguntas repetidas, campo do profissional, alerta no perfil clínico e no atendimento; legado recolhido', async ({ page, request }) => {
    test.setTimeout(150_000);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const legado = nomeClienteTeste('Formulario Legado');
    try {
      const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string; alertasClinicos?: string[] }>;
      const cliente = clientes.find((c) => c.nome === nomeCliente)!;
      expect(cliente.alertasClinicos).toContain(MULTIPLA);
      const fichaTotem = JSON.stringify(await (await request.get(`${apiBase()}/clientes/${cliente.id}/fichas`, { headers: sup })).json());
      expect(fichaTotem).toContain(OPCOES[0]);
      expect(fichaTotem).toContain(OPCAO_ALERTA);
      expect(fichaTotem).not.toContain(OBS_NOVA); // opcional em branco não entra na ficha

      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Clientes$/ }).first().click();
      await page.getByLabel('Buscar cliente').fill(nomeCliente);
      const linha = page.getByRole('row', { name: new RegExp(nomeCliente) });
      await expect(linha.getByRole('note', { name: new RegExp(`Alerta clínico: .*${sufixo}`) })).toBeVisible();
      await linha.getByRole('button', { name: 'Ver ficha de anamnese' }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(`${OBRIGATORIA} *`)).toHaveCount(1);
      await expect(resumo.getByText('Ficha anterior (legado)')).toHaveCount(0);
      await expect(resumo.getByRole('button', { name: /Alterar ficha|Preencher ficha/ })).toHaveCount(0);
      // Obrigatória do profissional em branco: a ficha aponta a pergunta
      await resumo.getByRole('button', { name: 'Salvar respostas' }).click();
      await expect(resumo.getByRole('alert')).toContainText(`Responda: ${PROF}`);
      await resumo.getByLabel(`${PROF} *`).fill('Usa joelheira');
      await resumo.getByRole('button', { name: 'Salvar respostas' }).click();
      await expect(resumo.getByRole('status')).toContainText('Ficha salva');
      await print(page, 'ficha-equipe');
      await resumo.getByRole('button', { name: 'Fechar' }).last().click();

      // Detalhes do agendamento: busca pelo código da reserva na agenda
      const ags = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${cliente.id}`, { headers: sup })).json()) as Array<{ id: string }>;
      await page.getByRole('button', { name: 'Agenda', exact: true }).click();
      const busca = page.getByLabel('Buscar cliente, serviço ou código da reserva');
      await busca.fill(codigoReserva(ags[0].id));
      await busca.press('Enter');
      const detalhe = page.getByRole('dialog', { name: /Editar Agendamento/ });
      await expect(detalhe.getByRole('note', { name: new RegExp(`Alerta clínico: .*${sufixo}`) })).toBeVisible();
      await page.keyboard.press('Escape');

      // Cliente com ficha antiga: legado recolhido, só leitura
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome: legado }], confirmar: true } })).status()).toBe(201);
      const c2 = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string }>).find((c) => c.nome === legado)!;
      expect((await request.put(`${apiBase()}/clientes/${c2.id}`, { headers: sup, data: { observacao: '__ANAMNESE_JSON__:{"alergia":"Amendoim"}' } })).status()).toBe(200);
      await page.getByRole('button', { name: /Clientes$/ }).first().click();
      await page.getByLabel('Buscar cliente').fill(legado);
      await page.getByRole('row', { name: new RegExp(legado) }).getByRole('button', { name: 'Ver ficha de anamnese' }).click();
      const bloco = resumo.getByText('Ficha anterior (legado)');
      await expect(bloco).toBeVisible();
      await expect(resumo.getByText('Alergias: Amendoim')).toBeHidden();
      await bloco.click();
      await expect(resumo.getByText('Alergias: Amendoim')).toBeVisible();
      await expect(resumo.getByText(`${OBRIGATORIA} *`)).toHaveCount(1);
      await print(page, 'ficha-legado');
    } finally {
      await apagarClienteDeTeste(request, [nomeCliente, legado]);
    }
  });

  test('cenário 5: recepção grava a ficha às cegas (sem histórico nem alerta) e a supervisão vê a ficha com o alerta', async ({ page, request }) => {
    test.setTimeout(150_000);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const rec = await authHeaders(request, CONTAS.recepcao);
    const nome = nomeClienteTeste('Ficha Recepcao');
    try {
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
      const id = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string }>).find((c) => c.nome === nome)!.id;
      // API: perguntas sem campo do profissional nem regra de alerta; leitura das fichas segue proibida
      const perguntas = await request.get(`${apiBase()}/formulario-anamnese/recepcao`, { headers: rec });
      expect(perguntas.status()).toBe(200);
      const texto = await perguntas.text();
      expect(texto).toContain(MULTIPLA);
      expect(texto).not.toContain(PROF);
      expect(texto).not.toContain('respostasAlerta');
      expect((await request.get(`${apiBase()}/formulario-anamnese/recepcao`, { headers: await authHeaders(request, CONTAS.colaboradora) })).status()).toBe(403);
      expect((await request.get(`${apiBase()}/clientes/${id}/fichas`, { headers: rec })).status()).toBe(403);

      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await page.getByLabel('Buscar cliente').fill(nome);
      const linha = page.getByRole('row', { name: new RegExp(nome) });
      await expect(linha.getByText('Sem ficha')).toBeVisible();
      await linha.getByTitle('Ver ficha de anamnese').click();
      await page.getByRole('button', { name: /Atualizar ficha|Preencher ficha/ }).click();
      const ficha = page.getByRole('dialog', { name: 'Nova ficha de anamnese' });
      await expect(ficha.getByText(/Por privacidade \(LGPD\)/)).toBeVisible();
      await expect(ficha.getByText(MULTIPLA)).toBeVisible();
      await expect(ficha.getByText(PROF)).toHaveCount(0);
      await expect(ficha.getByText(/Histórico de fichas|Ficha anterior \(legado\)/)).toHaveCount(0);
      await expect(ficha.getByRole('note', { name: /Alerta clínico/ })).toHaveCount(0);
      await ficha.getByRole('button', { name: 'Salvar ficha' }).click();
      await expect(ficha.getByRole('alert')).toContainText(`Responda: ${OBRIGATORIA}`);
      await ficha.getByRole('button', { name: `${OBRIGATORIA}: Não` }).click();
      await ficha.getByRole('button', { name: `${MULTIPLA}: ${OPCAO_ALERTA}` }).click();
      await ficha.getByRole('button', { name: 'Salvar ficha' }).click();
      await expect(ficha).toBeHidden();
      await expect(linha.getByText('Sem ficha')).toBeHidden();
      await expect(linha.getByRole('note', { name: /Alerta clínico/ })).toHaveCount(0);
      await print(page, 'ficha-recepcao');

      // Gravação direta: campo do profissional injetado é descartado e a resposta não traz dado de saúde
      const direto = await request.post(`${apiBase()}/clientes/${id}/fichas/recepcao`, { headers: rec, data: { respostas: {} } });
      expect(direto.status()).toBe(400);
      const fichas = (await (await request.get(`${apiBase()}/clientes/${id}/fichas`, { headers: sup })).json()) as Array<{ canal: string; alertas: string[]; snapshot: { itens: Array<{ rotulo: string }> } }>;
      expect(fichas[0].canal).toBe('recepcao');
      expect(fichas[0].alertas).toContain(MULTIPLA);
      expect(JSON.stringify(fichas[0].snapshot)).not.toContain(PROF);
      const recLista = ((await (await request.get(`${apiBase()}/clientes`, { headers: rec })).json()) as Array<{ id: string; temAnamnese: boolean; alertasClinicos?: string[] }>).find((c) => c.id === id)!;
      expect(recLista.temAnamnese).toBe(true);
      expect(recLista.alertasClinicos ?? []).toEqual([]);

      // Supervisão: ficha da recepção no formato dinâmico e alerta no perfil clínico
      await page.context().clearCookies();
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Clientes$/ }).first().click();
      await page.getByLabel('Buscar cliente').fill(nome);
      await expect(linha.getByRole('note', { name: new RegExp(`Alerta clínico: .*${sufixo}`) })).toBeVisible();
      await linha.getByRole('button', { name: 'Ver ficha de anamnese' }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await resumo.getByText(/Histórico de fichas/).click();
      await expect(resumo.getByText(/· Recepção/)).toBeVisible();
      await expect(resumo.getByText(`${MULTIPLA}: ${OPCAO_ALERTA}`)).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('recepção: injeção em campo do profissional é ignorada e a resposta é mínima', async ({ request }) => {
    const sup = await authHeaders(request, CONTAS.supervisor);
    const rec = await authHeaders(request, CONTAS.recepcao);
    const nome = nomeClienteTeste('Ficha Recepcao API');
    try {
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
      const id = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string }>).find((c) => c.nome === nome)!.id;
      const { campos } = (await lerFormulario(request));
      const prof = campos.find((c) => c.rotulo === PROF)!;
      const obrig = campos.find((c) => c.rotulo === OBRIGATORIA)!;
      const r = await request.post(`${apiBase()}/clientes/${id}/fichas/recepcao`, { headers: rec, data: { respostas: { [obrig.id]: 'Sim', [prof.id]: 'forjado' } } });
      expect(r.status(), await r.text()).toBe(201);
      expect(Object.keys(await r.json()).sort()).toEqual(['id', 'preenchidoEm']);
      const fichas = JSON.stringify(await (await request.get(`${apiBase()}/clientes/${id}/fichas`, { headers: sup })).json());
      expect(fichas).not.toContain('forjado');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('cenário 6: recepção cadastra cliente novo com a ficha dinâmica; supervisão vê a ficha e o alerta', async ({ page, request }) => {
    test.setTimeout(150_000);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const nome = nomeClienteTeste('Novo Dinamico');
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: 'Clientes', exact: true }).click();
      await page.getByRole('button', { name: 'Novo cliente' }).click();
      const novo = page.getByRole('dialog', { name: 'Novo cliente' });
      await novo.getByLabel('Nome completo').fill(nome);
      await novo.getByRole('button', { name: 'Preencher ficha' }).click();
      const ficha = page.getByRole('dialog', { name: 'Nova ficha de anamnese' });
      await expect(ficha.getByText(/Por privacidade \(LGPD\)/)).toBeVisible();
      await expect(ficha.getByText(PROF)).toHaveCount(0);
      await ficha.getByRole('button', { name: `${OBRIGATORIA}: Não` }).click();
      await ficha.getByRole('button', { name: `${MULTIPLA}: ${OPCAO_ALERTA}` }).click();
      await ficha.getByRole('button', { name: 'Concluir ficha' }).click();
      await expect(ficha).toBeHidden();
      await expect(novo).toContainText('preenchida');
      await novo.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(novo).toBeHidden();
      await page.getByLabel('Buscar cliente').fill(nome);
      const linha = page.getByRole('row', { name: new RegExp(nome) });
      await expect(linha).toBeVisible();
      await expect(linha.getByText('Sem ficha')).toHaveCount(0);
      await expect(linha.getByRole('note', { name: /Alerta clínico/ })).toHaveCount(0);

      const lista = (await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string; alertasClinicos?: string[] }>;
      const c = lista.find((x) => x.nome === nome)!;
      expect(c.alertasClinicos).toContain(MULTIPLA);
      const fichas = (await (await request.get(`${apiBase()}/clientes/${c.id}/fichas`, { headers: sup })).json()) as Array<{ canal: string }>;
      expect(fichas[0]?.canal).toBe('recepcao');
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('cenário 7: reserva para cliente sem cadastro usa a ficha dinâmica (sem campos fixos antigos)', async ({ page, request }) => {
    test.setTimeout(150_000);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const nome = nomeClienteTeste('Reserva Dinamica');
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: /Nova Reserva/i }).click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByRole('button', { name: /Novo Cliente/i }).click();
      await modal.getByPlaceholder('Nome completo').fill(nome);
      await modal.getByRole('button', { name: /\+ Ficha do Cliente/ }).click();
      const ficha = page.getByRole('dialog', { name: 'Nova ficha de anamnese' });
      await expect(ficha.getByText(MULTIPLA)).toBeVisible();
      await expect(ficha.getByText(PROF)).toHaveCount(0);
      await expect(ficha.getByText(/Marcapasso|Profissão/)).toHaveCount(0);
      await ficha.getByRole('button', { name: `${OBRIGATORIA}: Sim` }).click();
      await ficha.getByRole('button', { name: 'Concluir ficha' }).click();
      await expect(ficha).toBeHidden();

      let salvo = false;
      for (const d of [40, 41, 42, 43]) {
        await modal.locator('input[type="date"]').first().fill(diaFuturo(d));
        const servico = modal.getByRole('button', { name: /E2E Massagem/ }).first();
        if (!(await servico.textContent())?.includes('Selecionado')) await servico.click();
        const profissional = modal.locator('select').first();
        if ((await profissional.locator('option:not([disabled])').count()) && !(await profissional.inputValue())) await profissional.selectOption({ index: 1 });
        for (const h of ['09:00', '11:00', '14:00', '16:00']) {
          await modal.locator('input[type="time"]').first().fill(h);
          await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();
          try { await expect(modal).toBeHidden({ timeout: 5_000 }); salvo = true; break; } catch {
            const entendi = page.getByRole('button', { name: /Entendi/i });
            if (await entendi.count()) await entendi.first().click();
          }
        }
        if (salvo) break;
      }
      expect(salvo, 'agendamento não salvo').toBe(true);
      const c = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string; temAnamnese: boolean }>).find((x) => x.nome === nome)!;
      expect(c.temAnamnese).toBe(true);
      const fichas = (await (await request.get(`${apiBase()}/clientes/${c.id}/fichas`, { headers: sup })).json()) as Array<{ canal: string; snapshot: unknown }>;
      expect(fichas[0]?.canal).toBe('recepcao');
      expect(JSON.stringify(fichas[0]?.snapshot)).toContain(OBRIGATORIA);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('API: /equipe barra a recepção, PUT com versão antiga dá 409, totem sem regras internas e reserva com ficha inválida não grava nada', async ({ request }) => {
    const rec = await authHeaders(request, CONTAS.recepcao);
    const sup = await authHeaders(request, CONTAS.supervisor);
    expect((await request.get(`${apiBase()}/formulario-anamnese/equipe`, { headers: rec })).status()).toBe(403);
    expect((await request.get(`${apiBase()}/formulario-anamnese/equipe`, { headers: await authHeaders(request, CONTAS.colaboradora) })).status()).toBe(200);

    const atual = await lerFormulario(request);
    const velho = await request.put(`${apiBase()}/formulario-anamnese`, { headers: await authHeaders(request, CONTAS.admin), data: { versao: atual.versao - 1, campos: atual.campos } });
    expect(velho.status()).toBe(409);

    const publico = await (await request.get(`${apiBase()}/autoatendimento/formulario`)).text();
    for (const proibido of ['respostasAlerta', '"canal"', PROF]) expect(publico).not.toContain(proibido);

    const nome = nomeClienteTeste('Ficha Invalida');
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = equipe.find((e) => e.email === CONTAS.colaboradora)!.id;
    const multipla = atual.campos.find((c) => c.rotulo === MULTIPLA)!;
    try {
      const r = await request.post(`${apiBase()}/agendamentos`, {
        headers: rec,
        data: { collaboratorId: helenaId, date: diaFuturo(60), time: '10:00', serviceNames: ['E2E Massagem'], clientName: nome, respostasFicha: { [multipla.id]: ['Opção que não existe'] } },
      });
      expect(r.status(), await r.text()).toBe(400);
      const lista = (await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ nome: string }>;
      expect(lista.some((c) => c.nome === nome), 'transação desfeita: cliente não criado').toBe(false);

      // Cliente já cadastrado: ficha inválida não deixa agendamento nem ficha
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
      const id = ((await (await request.get(`${apiBase()}/clientes`, { headers: sup })).json()) as Array<{ id: string; nome: string }>).find((c) => c.nome === nome)!.id;
      const r2 = await request.post(`${apiBase()}/agendamentos`, {
        headers: rec,
        data: { collaboratorId: helenaId, date: diaFuturo(61), time: '10:00', serviceNames: ['E2E Massagem'], clientId: id, respostasFicha: { [multipla.id]: ['Opção que não existe'] } },
      });
      expect(r2.status(), await r2.text()).toBe(400);
      expect(await (await request.get(`${apiBase()}/agendamentos?clienteId=${id}`, { headers: sup })).json()).toEqual([]);
      expect(await (await request.get(`${apiBase()}/clientes/${id}/fichas`, { headers: sup })).json()).toEqual([]);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('cenário 4: editor e totem no celular (375x812) sem corte horizontal e com botões de toque', async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: 'Totem & Autoatendimento' }).click();
      await page.getByRole('button', { name: 'Personalizar formulário' }).click();
      const modal = page.getByRole('dialog', { name: 'Personalizar formulário de anamnese' });
      await abrirCard(modal, MULTIPLA);
      await expect(card(modal, MULTIPLA).getByLabel(`Opção 1 de ${MULTIPLA}`)).toBeVisible();
      await semCorteHorizontal(page);
      await semCorteHorizontal(page, '[role="dialog"]');
      for (const nome of ['+ Nova pergunta', 'Salvar formulário', 'Fechar']) {
        const caixa = await modal.getByRole('button', { name: nome, exact: true }).boundingBox();
        expect(caixa!.height, `altura do botão ${nome}`).toBeGreaterThanOrEqual(44);
      }
      // Rodapé fixo: o botão de salvar fica na tela mesmo com a lista longa
      await expect(modal.getByRole('button', { name: 'Salvar formulário' })).toBeInViewport();
      await print(page, 'editor-mobile');
      await modal.getByRole('button', { name: 'Fechar', exact: true }).click();

      // Totem numa sessão sem login (como o aparelho do cliente)
      const totemCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
      const totem = await totemCtx.newPage();
      try {
        await abrirTotem(totem);
        await expect(totem.getByText(MULTIPLA)).toBeVisible({ timeout: 15_000 });
        await semCorteHorizontal(totem);
        const opcao = await totem.getByRole('button', { name: `${MULTIPLA}: ${OPCOES[0]}` }).boundingBox();
        expect(opcao!.height).toBeGreaterThanOrEqual(44);
        await print(totem, 'totem-mobile');
        // Libera o horário pré-reservado (não chega a virar agendamento)
        await totem.getByRole('button', { name: /Alterar Horário/i }).click();
      } finally {
        await totemCtx.close();
      }
    } finally {
      await context.close();
    }
  });
});
