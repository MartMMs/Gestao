import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import io from 'socket.io-client';
import { CONTAS, apagarClienteDeTeste, apagarColaboradorDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

const TOTEM = '[Anamnese Autoatendimento 2026-11-01]: alergia a lavanda declarada no totem';
const JSON_FICHA = '__ANAMNESE_JSON__:{"alergia":"Lavanda","queixa":"lombar"}';
const NOTA = 'Prefere a sala 2';
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean };

const clientes = async (request: APIRequestContext, conta: string) =>
  (await (await request.get(`${apiBase()}/clientes`, { headers: await authHeaders(request, conta) })).json()) as ClienteApi[];

// Cliente sem ficha pela importação (não depende da chave "exigir anamnese")
const criarCliente = async (request: APIRequestContext, nome: string, observacao?: string) => {
  const sup = await authHeaders(request, CONTAS.supervisor);
  expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
  const c = (await clientes(request, CONTAS.supervisor)).find((x) => x.nome === nome)!;
  // A linha do totem só o totem grava (a API recusa): direto no banco de testes
  if (observacao !== undefined) {
    const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
    try { await db.cliente.update({ where: { id: c.id }, data: { observacao } }); } finally { await db.$disconnect(); }
  }
  return c;
};

const abrirClientes = async (page: Page, conta: string, nome: string) => {
  await page.goto('/');
  await loginPelaTela(page, conta);
  await page.getByRole('button', { name: /Clientes$/ }).first().click();
  await page.getByLabel('Buscar cliente').fill(nome);
};


test.describe('Ficha de anamnese: visualização e edição', () => {
  test('supervisor: nome abre o resumo com JSON e totem; "Alterar ficha" edita e grava sem perder nota nem totem', async ({ page, request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco de testes');
    const nome = nomeClienteTeste('BancaTeste Lista');
    const c = await criarCliente(request, nome, `${NOTA}\n${TOTEM}\n${JSON_FICHA}`);
    try {
      await abrirClientes(page, CONTAS.supervisor, nome);
      const linha = page.getByRole('row', { name: new RegExp(nome) });
      // Pelo ícone
      await linha.getByRole('button', { name: 'Ver ficha de anamnese' }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText('Alergias: Lavanda')).toBeVisible();
      await expect(resumo.getByText('Queixa: lombar')).toBeVisible();
      await expect(resumo.getByText(TOTEM)).toBeVisible();
      await resumo.getByRole('button', { name: 'Fechar' }).last().click();
      await expect(resumo).toBeHidden();
      // Pelo nome
      await linha.getByRole('button', { name: nome, exact: true }).click();
      await expect(resumo.getByText(TOTEM)).toBeVisible();
      await resumo.getByRole('button', { name: 'Alterar ficha' }).click();
      const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true });
      const alergia = ficha.locator('label:has-text("Tem alguma alergia?") + input');
      await expect(alergia).toHaveValue('Lavanda');
      await alergia.fill('Lavanda e rosa');
      await ficha.getByRole('button', { name: /Concluir ficha/ }).click();
      await expect(ficha).toBeHidden();
      await expect.poll(async () => (await clientes(request, CONTAS.supervisor)).find((x) => x.id === c.id)?.observacao ?? '').toContain('Lavanda e rosa');
      const obs = (await clientes(request, CONTAS.supervisor)).find((x) => x.id === c.id)!.observacao!;
      expect(obs).toContain(NOTA);
      expect(obs).toContain(TOTEM);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('supervisor: cliente sem ficha mostra "Nenhuma ficha" e "Preencher ficha" abre o formulário', async ({ page, request }) => {
    const nome = nomeClienteTeste('BancaTeste Sem');
    await criarCliente(request, nome);
    try {
      await abrirClientes(page, CONTAS.supervisor, nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(/Nenhuma ficha de anamnese registrada/)).toBeVisible();
      await resumo.getByRole('button', { name: 'Preencher ficha', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true })).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('recepção: lista de clientes mostra só o aviso (sem expor saúde) e permite atualizar a ficha no balcão preservando nota/totem', async ({ page, request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco de testes');
    const nome = nomeClienteTeste('BancaTeste Recepcao');
    const c = await criarCliente(request, nome, `${NOTA}\n${TOTEM}\n${JSON_FICHA}`);
    try {
      await abrirClientes(page, CONTAS.recepcao, nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(/já tem ficha registrada/)).toBeVisible();
      await expect(resumo.getByText(/Lavanda|lavanda/)).toHaveCount(0);
      await expect(resumo.getByText('Sem ficha')).toHaveCount(0);
      await resumo.getByRole('button', { name: 'Atualizar ficha' }).click();
      const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true });
      const alergia = ficha.locator('label:has-text("Tem alguma alergia?") + input');
      await expect(alergia).toHaveValue('');
      await alergia.fill('Alecrim');
      await ficha.getByRole('button', { name: /Concluir ficha/ }).click();
      await expect(ficha).toBeHidden();
      await expect.poll(async () => (await clientes(request, CONTAS.supervisor)).find((x) => x.id === c.id)?.observacao ?? '').toContain('Alecrim');
      const obs = (await clientes(request, CONTAS.supervisor)).find((x) => x.id === c.id)!.observacao!;
      expect(obs).toContain(NOTA);
      expect(obs).toContain(TOTEM);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('profissional com acesso: "Ver ficha" mostra JSON e totem, edita e o agendamento grava a ficha nova sem perder nota/totem', async ({ page, request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco de testes');
    test.setTimeout(150_000);
    const nome = nomeClienteTeste('BancaTeste Prof');
    const c = await criarCliente(request, nome, `${NOTA}\n${TOTEM}\n${JSON_FICHA}`);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = equipe.find((e) => e.email === CONTAS.colaboradora)!.id;
    try {
      // Atendimento marcado pela supervisão nos próximos 7 dias: libera a ficha à Helena
      let marcado = false;
      for (let d = 1; d <= 5 && !marcado; d += 1) {
        for (const h of ['08:00', '19:00', '12:00', '15:00']) {
          const r = await request.post(`${apiBase()}/agendamentos`, { headers: sup, data: { collaboratorId: helenaId, date: diaFuturo(d), time: h, serviceNames: ['E2E Massagem'], clientId: c.id } });
          if (r.status() === 201) { marcado = true; break; }
        }
      }
      expect(marcado, 'sem horário livre para a Helena nos próximos dias').toBe(true);
      const daHelena = (await clientes(request, CONTAS.colaboradora)).find((x) => x.id === c.id);
      expect(daHelena?.observacao, 'API deveria liberar a observação à Helena').toContain(TOTEM);

      await page.goto('/');
      await loginPelaTela(page, CONTAS.colaboradora);
      const dia = diaFuturo(20);
      await page.locator('input[type="date"]').first().fill(dia);
      await page.getByRole('button', { name: /Agendar/i }).click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByPlaceholder('Digite nome, telefone ou CPF').fill(nome);
      await modal.getByRole('button', { name: new RegExp(nome) }).first().click();
      await modal.getByRole('button', { name: 'Ver ficha', exact: true }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText('Alergias: Lavanda')).toBeVisible();
      await expect(resumo.getByText(TOTEM)).toBeVisible();
      await resumo.getByRole('button', { name: 'Alterar ficha' }).click();
      const ficha = page.getByRole('dialog', { name: 'Ficha de anamnese', exact: true });
      const alergia = ficha.locator('label:has-text("Tem alguma alergia?") + input');
      await expect(alergia).toHaveValue('Lavanda');
      await alergia.fill('Lavanda e cravo');
      await ficha.getByRole('button', { name: /Concluir ficha/ }).click();
      await expect(ficha).toBeHidden();
      // "Ver Ficha do Cliente" reflete a alteração ainda não gravada
      await modal.getByRole('button', { name: 'Ver Ficha do Cliente' }).click();
      await expect(resumo.getByText('Alergias: Lavanda e cravo')).toBeVisible();
      await resumo.getByRole('button', { name: 'Fechar' }).last().click();

      await modal.locator('input[type="date"]').first().fill(dia);
      await modal.getByRole('button', { name: /E2E Massagem/ }).first().click();
      let salvo = false;
      for (const h of ['09:00', '11:00', '14:00', '16:00', '18:00']) {
        await modal.locator('input[type="time"]').first().fill(h);
        await modal.getByRole('button', { name: /Confirmar Agendamento/i }).click();
        try { await expect(modal).toBeHidden({ timeout: 6_000 }); salvo = true; break; } catch {
          const entendi = page.getByRole('button', { name: /Entendi/i });
          if (await entendi.count()) await entendi.first().click();
        }
      }
      expect(salvo, 'agendamento da Helena não foi salvo').toBe(true);
      const obs = (await clientes(request, CONTAS.supervisor)).find((x) => x.id === c.id)!.observacao!;
      expect(obs).toContain('Lavanda e cravo');
      expect(obs).toContain(NOTA);
      expect(obs).toContain(TOTEM);
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});


test.describe('Config da empresa: aviso em tempo real', () => {
  test('PUT /empresa/config emite empresa:config_atualizada e não emite db_updated sem escopo', async ({ request }) => {
    const token = (await authHeaders(request, CONTAS.admin)).Authorization.replace('Bearer ', '');
    const url = apiBase().replace(/\/api$/, '');
    const socket = io(url, { auth: { token }, transports: ['websocket'] });
    const eventos: Array<{ nome: string; dados: unknown }> = [];
    socket.on('db_updated', (d: unknown) => eventos.push({ nome: 'db_updated', dados: d }));
    socket.on('empresa:config_atualizada', (d: unknown) => eventos.push({ nome: 'config', dados: d }));
    await new Promise<void>((ok, erro) => { socket.on('connect', () => ok()); socket.on('connect_error', erro); });
    const admin = await authHeaders(request, CONTAS.admin);
    const atual = await (await request.get(`${apiBase()}/empresa/config`, { headers: admin })).json();
    try {
      const r = await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: `${atual.endereco ?? ''} BancaTeste`.trim().slice(0, 200) } });
      expect(r.status(), await r.text()).toBe(200);
      await new Promise((ok) => setTimeout(ok, 1500));
      expect(eventos.filter((e) => e.nome === 'config')).toHaveLength(1);
      // Outros testes em paralelo emitem db_updated com escopo; o PUT da config não pode emitir o "recarrega tudo"
      expect(eventos.filter((e) => e.nome === 'db_updated' && !(e.dados as { escopos?: unknown })?.escopos)).toEqual([]);
    } finally {
      await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { endereco: atual.endereco } });
      socket.disconnect();
    }
  });

});

test.describe('Criar Usuário no Admin', () => {
  test('erro e depois sucesso: o alerta some e as credenciais aparecem', async ({ page, request }) => {
    const sufixo = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const email = `bancateste.${sufixo}@teste.com`;
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.admin);
      await page.getByRole('button', { name: /Equipe & Papéis/i }).click();
      await page.getByRole('button', { name: /Criar Usuário/i }).click();
      const dialogo = page.getByRole('dialog', { name: /Criar Usuário/i });
      await dialogo.getByPlaceholder('Nome', { exact: true }).fill('Ab');
      await dialogo.getByLabel('Usuário de acesso').fill(`banca.${Date.now()}`);
      await dialogo.getByPlaceholder('Cargo (ex.: Massagista)').fill('Teste');
      await dialogo.getByRole('button', { name: 'Cadastrar' }).click();
      const alerta = page.getByRole('alert').filter({ hasText: 'Informe o nome completo do colaborador.' });
      await expect(alerta).toBeVisible();

      await dialogo.getByPlaceholder('Nome', { exact: true }).fill(`BancaTeste Cadastro ${sufixo}`);
      await dialogo.getByPlaceholder('E-mail (opcional)').fill(email);
      await dialogo.getByRole('button', { name: 'Cadastrar' }).click();
      await expect(page.getByText(/Senha provisória/)).toBeVisible();
      await expect(page.getByText(email).first()).toBeVisible();
      await expect(alerta).toHaveCount(0);
    } finally {
      await apagarColaboradorDeTeste(request, email);
    }
  });
});


test.describe('Ficha: recepção no balcão e abusos de tela', () => {
  test('recepção, cliente sem ficha: o resumo oferece "Preencher ficha" para cadastro presencial no balcão', async ({ page, request }) => {
    const nome = nomeClienteTeste('BancaTeste RecSem');
    await criarCliente(request, nome);
    try {
      await abrirClientes(page, CONTAS.recepcao, nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(/Nenhuma ficha de anamnese registrada/)).toBeVisible();
      await expect(resumo.getByRole('button', { name: 'Preencher ficha', exact: true })).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('agendamento pela recepção, cliente sem ficha: Esc fecha só o resumo mantendo o modal de agendamento', async ({ page, request }) => {
    const nome = nomeClienteTeste('BancaTeste Esc');
    await criarCliente(request, nome);
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.recepcao);
      await page.getByRole('button', { name: /Agendar/i }).first().click();
      const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
      await modal.getByPlaceholder('Digite nome, telefone ou CPF').fill(nome);
      await modal.getByRole('button', { name: new RegExp(nome) }).first().click();
      await modal.getByRole('button', { name: 'Ver ficha', exact: true }).click();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo.getByText(/Nenhuma ficha de anamnese registrada/)).toBeVisible();
      await expect(resumo.getByRole('button', { name: 'Preencher ficha', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(resumo).toBeHidden();
      await expect(modal).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });

  test('duplo clique no nome do cliente abre a ficha e ela continua aberta', async ({ page, request }) => {
    const nome = nomeClienteTeste('BancaTeste Duplo');
    await criarCliente(request, nome);
    try {
      await abrirClientes(page, CONTAS.supervisor, nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).dblclick();
      const resumo = page.getByRole('dialog', { name: 'Resumo da ficha de anamnese' });
      await expect(resumo).toBeVisible();
      await page.waitForTimeout(300);
      await expect(resumo).toBeVisible();
      // Um clique simples fora continua fechando
      await page.mouse.click(5, 5);
      await expect(resumo).toBeHidden();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});
