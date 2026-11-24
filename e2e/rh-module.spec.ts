import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, loginPelaTela } from './credenciais';

/**
 * Módulo de RH e Escalas: quem pode editar (RBAC), lista lateral x calendário (master-detail), edição de um dia
 * e o alerta de interjornada da CLT. Só a supervisão abre o módulo; admin, recepção e profissional não.
 * Usa o mês que vem: todos os dias ainda podem ser alterados.
 */

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const [ano, mesAtual] = hoje.split('-').map(Number);
const mes = new Date(Date.UTC(ano, mesAtual, 1, 12)).toISOString().slice(0, 7);
const data = (n: number) => `${mes}-${String(n).padStart(2, '0')}`;
const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const criarColaborador = async (request: APIRequestContext, nome: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const s = sufixo();
  const r = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome, email: `rh.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '5x2' },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as string;
};

const ajustar = async (request: APIRequestContext, colaboradorId: string, n: number, ajuste: { tipo: string; turno?: string }) => {
  const r = await request.post(`${apiBase()}/escala/override`, { headers: await authHeaders(request, CONTAS.admin), data: { colaboradorId, data: data(n), ...ajuste } });
  expect(r.ok(), await r.text()).toBeTruthy();
};

const apagarColaborador = async (request: APIRequestContext, id: string) =>
  request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });

const novaSessao = async (browser: Browser, conta: string) => {
  const contexto = await browser.newContext(); // cada perfil no seu contexto: cookies de sessão separados
  const page = await contexto.newPage();
  await page.goto('/');
  await loginPelaTela(page, conta);
  return { contexto, page };
};

const lista = (page: Page) => page.getByRole('complementary', { name: 'Colaboradores da escala' });
const dia = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^${n} de [^.]+\\.`) });

const abrirGrade = async (page: Page) => {
  await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
  await page.getByRole('button', { name: /Grade de Escalas/i }).click();
  await expect(lista(page)).toBeVisible();
};

const abrirMesQueVem = async (page: Page, nome: string) => {
  await lista(page).getByRole('button', { name: new RegExp(nome) }).click();
  await page.getByTitle('Próximo mês').click();
};

test.describe('Módulo de RH: permissões por função', () => {
  test('só a supervisão edita a escala; admin, recepção e profissional não têm o módulo', async ({ browser, request }) => {
    const supervisor = await novaSessao(browser, CONTAS.supervisor);
    const admin = await novaSessao(browser, CONTAS.admin);
    const recepcao = await novaSessao(browser, CONTAS.recepcao);
    const profissional = await novaSessao(browser, CONTAS.colaboradora);
    try {
      await abrirGrade(supervisor.page);
      await expect(supervisor.page.getByRole('button', { name: '+ Nova Escala' })).toBeVisible();
      // Modal "Gerar escala": foco no primeiro campo, Tab preso dentro, Esc fecha e devolve o foco ao botão
      const gerar = supervisor.page.getByRole('button', { name: '+ Nova Escala' });
      await gerar.click();
      const modal = supervisor.page.getByRole('dialog', { name: 'Gerar escala' });
      await expect.poll(() => modal.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      for (let i = 0; i < 30; i += 1) await supervisor.page.keyboard.press('Tab');
      await expect.poll(() => modal.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      await supervisor.page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await expect.poll(() => gerar.evaluate((b) => b === document.activeElement)).toBe(true);
      await expect(supervisor.page.getByRole('button', { name: /Editar Grade/i })).toHaveCount(0);
      await expect(supervisor.page.getByRole('button', { name: /Padrão 12x36/i })).toHaveCount(0);
      await expect(supervisor.page.getByRole('button', { name: /Filtros/i })).toBeVisible();
      await expect(supervisor.page.getByRole('button', { name: /Ações/i })).toBeVisible();

      for (const { page } of [admin, recepcao, profissional]) {
        await expect(page.getByRole('button', { name: /Acessar Módulo RH/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '+ Nova Escala' })).toHaveCount(0);
      }

      // Profissional só consulta a própria escala, sem nenhum botão de gravar
      await profissional.page.getByRole('button', { name: /Ver Minha Escala/i }).click();
      const minhaEscala = profissional.page.getByRole('dialog');
      await expect(minhaEscala.getByText(/feitas pela supervisão/i)).toBeVisible();
      await expect(minhaEscala.getByRole('button', { name: /Salvar|Editar|Nova Escala/i })).toHaveCount(0);

      // E a API recusa mesmo que alguém monte o pedido na mão
      const eu = await authHeaders(request, CONTAS.colaboradora);
      const tentativa = await request.post(`${apiBase()}/escala/override`, { headers: eu, data: { colaboradorId: 'qualquer', data: data(10), tipo: 'folga' } });
      expect([401, 403]).toContain(tentativa.status());
    } finally {
      for (const s of [supervisor, admin, recepcao, profissional]) await s.contexto.close();
    }
  });

  test('a lista lateral mostra supervisão e profissionais, nunca o administrador', async ({ page }) => {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await abrirGrade(page);
    const nomes = lista(page);
    await expect(nomes.getByRole('button', { name: /Supervisor E2E/ })).toBeVisible();
    await expect(nomes.getByRole('button', { name: /Helena E2E/ })).toBeVisible();
    await expect(nomes.getByRole('button', { name: /Admin E2E/ })).toHaveCount(0);
  });
});

test.describe('Módulo de RH: grade de escalas', () => {
  test('clicar em outro profissional troca o calendário sem recarregar a página', async ({ page, request }) => {
    const nomeA = `Rh Jose ${sufixo()}`;
    const nomeB = `Rh Maria ${sufixo()}`;
    const [a, b] = [await criarColaborador(request, nomeA), await criarColaborador(request, nomeB)];
    try {
      await ajustar(request, a, 12, { tipo: 'trabalho', turno: '08:00-18:00' });
      await ajustar(request, b, 12, { tipo: 'folga' });

      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await abrirGrade(page);
      await page.evaluate(() => { (window as unknown as { semRecarregar: boolean }).semRecarregar = true; });

      await abrirMesQueVem(page, nomeA);
      await expect(lista(page).getByRole('button', { name: new RegExp(nomeA) })).toHaveAttribute('aria-current', 'true');
      await expect(dia(page, 12)).toHaveAccessibleName(/08:00 às 18:00/);

      await lista(page).getByRole('button', { name: new RegExp(nomeB) }).click();
      await expect(lista(page).getByRole('button', { name: new RegExp(nomeB) })).toHaveAttribute('aria-current', 'true');
      await expect(dia(page, 12)).toHaveAccessibleName(/Folga/);

      // A marca no window sobrevive: foi troca de estado, não navegação
      expect(await page.evaluate(() => (window as unknown as { semRecarregar?: boolean }).semRecarregar)).toBe(true);
    } finally {
      await apagarColaborador(request, a);
      await apagarColaborador(request, b);
    }
  });

  test('dia sem turno: escolher o Comercial e salvar fecha o modal e pinta a célula', async ({ page, request }) => {
    const nome = `Rh Dia ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await ajustar(request, id, 14, { tipo: 'trabalho' }); // dia de trabalho sem turno, independe do ciclo
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await abrirGrade(page);
      await abrirMesQueVem(page, nome);
      await expect(dia(page, 14)).toHaveAccessibleName(/sem turno definido/);

      await dia(page, 14).click();
      const modal = page.getByRole('dialog');
      await modal.getByLabel('Turno').selectOption('08:00-18:00');
      await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(dia(page, 14)).toHaveAccessibleName(/Comercial, 08:00 às 18:00/);
    } finally {
      await apagarColaborador(request, id);
    }
  });

  test('turno de manhã logo depois de um noturno avisa a quebra de interjornada', async ({ page, request }) => {
    const nome = `Rh Interjornada ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    const supervisor = await authHeaders(request, CONTAS.supervisor);
    const turno = await request.post(`${apiBase()}/turnos`, { headers: supervisor, data: { nome: `Manhã curta ${sufixo()}`, inicio: '08:00', fim: '14:00' } });
    expect(turno.ok(), await turno.text()).toBeTruthy();
    const turnoId = (await turno.json()).id as string;
    try {
      await ajustar(request, id, 15, { tipo: 'trabalho', turno: '18:00-00:00' });
      await ajustar(request, id, 16, { tipo: 'trabalho' });
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await abrirGrade(page);
      await abrirMesQueVem(page, nome);

      await dia(page, 16).click();
      const modal = page.getByRole('dialog');
      await modal.getByLabel('Turno').selectOption('08:00-14:00');
      // 00:00 até 08:00 = 8h de descanso, abaixo das 11h do art. 66
      const aviso = modal.getByRole('alert').filter({ hasText: 'Atenção à CLT' });
      await expect(aviso).toContainText(/Descanso de 8h/);
      await expect(aviso).toContainText(/mínimo é 11h/);

      await modal.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(modal).toBeHidden();
      await expect(dia(page, 16)).toHaveAccessibleName(/Alerta: descanso de 8h entre jornadas/);
    } finally {
      await apagarColaborador(request, id);
      await request.delete(`${apiBase()}/turnos/${turnoId}`, { headers: supervisor });
    }
  });
});
