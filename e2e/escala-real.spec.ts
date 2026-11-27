import fs from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, loginPelaTela } from './credenciais';

/**
 * Pacote 3 (Escala Real): gerador com turno padrão (sem "s/ turno"), "Ver minha escala" do colaborador e da
 * recepção (só a própria escala, mesmo forçando outro id na URL) e Horas Previstas com exportação CSV.
 */

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const [ano, mesAtual] = hoje.split('-').map(Number);
const mesDoNatal = `${ano}-12`;
const mesesAteDezembro = 12 - mesAtual;
const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

type MeuDia = { data: string; tipo: string; turno: string | null };
const mesMais = (n: number) => new Date(Date.UTC(ano, mesAtual - 1 + n, 1, 12)).toISOString().slice(0, 7);
const minhaEscala = async (request: APIRequestContext, conta: string, query = '', mes = mesDoNatal) => {
  const r = await request.get(`${apiBase()}/minha-escala?month=${mes}${query}`, { headers: await authHeaders(request, conta) });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as { dias: MeuDia[]; resumo: Record<string, unknown> };
};

const abrirGrade = async (page: Page) => {
  await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
  await page.getByRole('button', { name: /Grade de Escalas/i }).click();
  await expect(page.getByRole('complementary', { name: 'Colaboradores da escala' })).toBeVisible();
};

test('supervisor gera a escala com turno padrão: Timeline sem "s/ turno", Horas Previstas soma certo e o CSV baixa', async ({ page, request }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const s = sufixo();
  const nome = `Escala Real ${s}`;
  const mm = String(1 + Math.floor(Math.random() * 58)).padStart(2, '0'); // horário único: turnos não repetem horário
  const turno = { nome: `E2E Real ${s}`, inicio: `09:${mm}`, fim: `18:${mm}` };
  const c = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome, email: `real.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '6x1' },
  });
  expect(c.status(), await c.text()).toBe(201);
  const id = (await c.json()).id as string;
  const t = await request.post(`${apiBase()}/turnos`, { headers: admin, data: turno });
  expect(t.status(), await t.text()).toBe(201);
  const turnoId = (await t.json()).id as string;
  try {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await abrirGrade(page);

    await page.getByRole('button', { name: '+ Nova Escala' }).click();
    const modal = page.getByRole('dialog', { name: 'Gerar escala' });
    await modal.getByRole('combobox', { name: 'Colaborador' }).fill(nome);
    await modal.getByRole('option', { name: new RegExp(nome) }).click();
    await expect(modal.getByRole('button', { name: 'Gerar Escala' })).toBeDisabled(); // turno é obrigatório
    await modal.getByLabel('Turno padrão').selectOption({ label: `${turno.nome} · ${turno.inicio}–${turno.fim}` });
    await modal.getByRole('button', { name: 'Gerar Escala' }).click();
    await expect(page.getByText('Escala gerada com sucesso.')).toBeVisible();

    // Timeline: todo dia de trabalho com o horário do turno
    await page.getByRole('group', { name: 'Visualização da escala' }).getByRole('button', { name: /Timeline/i }).click();
    const celulas = page.getByTitle(new RegExp(`^${nome} \\| `));
    await expect(celulas.first()).toBeVisible();
    await expect(celulas.filter({ hasText: turno.inicio }).first()).toBeVisible();
    await expect(celulas.filter({ hasText: 's/ turno' })).toHaveCount(0);

    // Horas Previstas: 9h de turno - 1h de intervalo = 8h por dia trabalhado, nenhum dia sem turno
    await page.getByRole('tab', { name: /Horas Previstas/i }).click();
    const linha = page.getByRole('row').filter({ hasText: nome });
    await expect(linha).not.toContainText('sem turno');
    const celulasLinha = linha.getByRole('cell');
    const dias = Number((await celulasLinha.nth(1).innerText()).trim());
    expect(dias).toBeGreaterThan(0);
    await expect(celulasLinha.nth(4)).toHaveText(`${dias * 8}h`);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^horas-previstas-\d{4}-\d{2}\.csv$/);
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Colaborador;Cargo;Mês;Dias trabalhados;Dias sem turno;Horas normais;Horas extras;Total');
    expect(csv.split('\r\n').find((l) => l.startsWith(`${nome};`))).toMatch(new RegExp(`;${dias};0;[\\d,]+;[\\d,]+;${dias * 8}$`));
  } finally {
    await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    await request.delete(`${apiBase()}/turnos/${turnoId}`, { headers: admin });
  }
});

test('colaboradora e recepção abrem "Ver minha escala": trabalho com horário, folga, férias e feriado', async ({ browser, request }) => {
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const antes = await minhaEscala(request, CONTAS.colaboradora);
  // Um dia de trabalho de dezembro ganha horário e outro vira férias (removidas no fim)
  const trabalho = antes.dias.filter((d) => d.tipo === 'trabalho' && d.data >= hoje);
  test.skip(trabalho.length < 2, 'mês sem dias de trabalho futuros para ajustar');
  const [diaTurno, diaFerias] = [trabalho[trabalho.length - 1], trabalho[trabalho.length - 2]];
  const helena = (await (await request.get(`${apiBase()}/colaboradores`, { headers: supervisor })).json() as Array<{ id: string; email?: string; nome?: string; name?: string }>)
    .find((c) => c.email === CONTAS.colaboradora || /Helena E2E/.test(c.nome ?? c.name ?? ''))!;
  const ok = async (p: Promise<{ ok(): boolean; text(): Promise<string> }>) => { const r = await p; expect(r.ok(), await r.text()).toBeTruthy(); };
  await ok(request.post(`${apiBase()}/escala/override`, { headers: supervisor, data: { colaboradorId: helena.id, data: diaTurno.data, tipo: 'trabalho', turno: '08:00-20:00' } }));
  await ok(request.post(`${apiBase()}/escala/override`, { headers: supervisor, data: { colaboradorId: helena.id, data: diaFerias.data, tipo: 'folga', descricao: 'Férias' } }));
  const contextos = [];
  try {
    const depois = await minhaEscala(request, CONTAS.colaboradora);
    const porData = new Map(depois.dias.map((d) => [d.data, d]));
    expect(porData.get(diaTurno.data)).toMatchObject({ tipo: 'trabalho', turno: '08:00-20:00' });
    expect(porData.get(diaFerias.data)?.tipo).toBe('ferias');
    // Feriado: o primeiro mês (até 1 ano) em que a escala dela tem um. O banco de CI pode ter ajustes que viram
    // feriados em dia de trabalho, então o dia vem da API e não é fixo
    let feriado: { meses: number; data: string } | null = null;
    for (let n = 0; n <= 12 && !feriado; n += 1) {
      const dia = (await minhaEscala(request, CONTAS.colaboradora, '', mesMais(n))).dias.find((d) => d.tipo === 'feriado');
      if (dia) feriado = { meses: n, data: dia.data };
    }
    expect(feriado, 'nenhum feriado na escala do próximo ano').not.toBeNull();

    for (const conta of [CONTAS.colaboradora, CONTAS.recepcao]) {
      const contexto = await browser.newContext({ acceptDownloads: false });
      contextos.push(contexto);
      const page = await contexto.newPage();
      await page.goto('/');
      await loginPelaTela(page, conta);
      await expect(page.getByRole('button', { name: /Minhas Folgas/i })).toHaveCount(0);
      await page.getByRole('button', { name: 'Ver minha escala' }).click();
      const modal = page.getByRole('dialog', { name: 'Minha Escala' });
      await expect(modal.getByText('Turno de hoje')).toBeVisible();
      await expect(modal.getByText('Próxima folga')).toBeVisible();
      await expect(modal.getByText('Alterações de escala e folgas são feitas pela supervisão.')).toBeVisible();
      const celula = (data: string) => modal.getByTitle(new RegExp(`^${data.split('-').reverse().join('/')} · `)); // DD/MM/AAAA
      if (conta === CONTAS.recepcao) {
        if ((await minhaEscala(request, conta, '', mesMais(0))).dias.length === 0) await expect(modal.getByText('Você não tem escala cadastrada neste mês.')).toBeVisible();
        else await expect(modal.getByTitle(new RegExp(`^\\d{2}/${mesMais(0).slice(5)}/${mesMais(0).slice(0, 4)} · `)).first()).toBeVisible();
      } else {
        for (let i = 0; i < feriado!.meses; i += 1) await modal.getByRole('button', { name: 'Próximo mês' }).click();
        await expect(celula(feriado!.data)).toContainText('Feriado');
        for (let i = feriado!.meses; i < mesesAteDezembro; i += 1) await modal.getByRole('button', { name: 'Próximo mês' }).click();
        for (let i = feriado!.meses; i > mesesAteDezembro; i -= 1) await modal.getByRole('button', { name: 'Mês anterior' }).click();
        await expect(modal.getByText(`dezembro de ${ano}`)).toBeVisible();
        await expect(celula(diaTurno.data)).toContainText('08:00–20:00');
        await expect(celula(diaFerias.data)).toContainText('Férias');
        const folga = depois.dias.find((d) => d.tipo === 'folga');
        if (folga) await expect(celula(folga.data)).toContainText('Folga');
      }
      await expect(modal.getByRole('button', { name: /Salvar|Editar/i })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    }
  } finally {
    for (const contexto of contextos) await contexto.close();
    await request.post(`${apiBase()}/escala/ausencia/remover`, { headers: supervisor, data: { colaboradorId: helena.id, inicio: diaFerias.data, fim: diaFerias.data, motivo: 'Férias' } });
    await request.post(`${apiBase()}/escala/override`, { headers: supervisor, data: { colaboradorId: helena.id, data: diaTurno.data, tipo: 'trabalho', turno: diaTurno.turno } });
  }
});

test('GET /minha-escala ignora o id de outra pessoa: devolve sempre a escala de quem está logado', async ({ request, playwright }) => {
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const equipe = await (await request.get(`${apiBase()}/colaboradores`, { headers: supervisor })).json() as Array<{ id: string; email?: string }>;
  const ana = equipe.find((c) => c.email === CONTAS.colaboradoraAlternativa || /Ana E2E/.test((c as { nome?: string }).nome ?? ''));
  const outroId = ana?.id ?? equipe[0].id;

  // Mês que nenhum outro teste altera (o teste acima mexe em dezembro e roda em paralelo)
  const mesFixo = mesMais(14);
  const minha = await minhaEscala(request, CONTAS.colaboradora, '', mesFixo);
  for (const forjado of [`&colaboradorId=${outroId}`, `&id=${outroId}`, `&userId=${outroId}`]) {
    expect((await minhaEscala(request, CONTAS.colaboradora, forjado, mesFixo)).dias).toEqual(minha.dias); // atualizadaEm muda com o teste paralelo
  }
  // Sem sessão: 401
  const anonimo = await playwright.request.newContext(); // sem os cookies de login dos passos acima
  expect((await anonimo.get(`${apiBase()}/minha-escala?month=${mesDoNatal}`)).status()).toBe(401);
  await anonimo.dispose();
  // A resposta não tem alertas de CLT nem dados de colegas
  expect(Object.keys(minha).sort()).toEqual(['dias', 'mes', 'resumo']);
});

test('gerar o mês seguinte com outro turno não muda o mês já gerado (turno e Horas Previstas) e preserva férias', async ({ page, request }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const s = sufixo();
  const c = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome: `Snapshot ${s}`, email: `snap.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '6x1' },
  });
  expect(c.status(), await c.text()).toBe(201);
  const id = (await c.json()).id as string;
  const [mes1, mes2] = [mesMais(1), mesMais(2)];
  const ajustes = async (mes: string) =>
    (await (await request.get(`${apiBase()}/escala/overrides?month=${mes}&colaboradorId=${id}`, { headers: admin })).json() as Array<{ data: string; tipo: string; turno: string | null; descricao: string | null }>)
      .map(({ data, tipo, turno, descricao }) => ({ data, tipo, turno, descricao }));
  const gerar = async (mes: string, turno: string) => {
    const r = await request.post(`${apiBase()}/escala/gerar-mes`, { headers: admin, data: { colaboradorId: id, mes, turno, tipoEscala: '6x1', folgasDomingoNoMes: 2 } });
    expect(r.status(), await r.text()).toBe(200);
  };
  // Total de Horas Previstas do colaborador no mês, lido na tela do RH
  const horasPrevistas = async (mes: string) => {
    await page.locator('#horas-previstas-mes').fill(mes2); // passa por outro mês para reler do servidor
    await page.locator('#horas-previstas-mes').fill(mes);
    const celulas = page.getByRole('row').filter({ hasText: `Snapshot ${s}` }).getByRole('cell');
    await expect(celulas.nth(4)).toHaveText(/^[1-9]\d*h$/); // espera a tela refletir a geração
    return { dias: Number((await celulas.nth(1).innerText()).trim()), total: (await celulas.nth(4).innerText()).trim() };
  };
  try {
    await page.goto('/');
    await loginPelaTela(page, CONTAS.supervisor);
    await abrirGrade(page);
    await page.getByRole('tab', { name: /Horas Previstas/i }).click();
    await gerar(mes1, '08:00-16:00');
    const mes1Antes = await ajustes(mes1);
    const horasAntes = await horasPrevistas(mes1);
    expect(horasAntes.total).toBe(`${horasAntes.dias * 7}h`); // 08–16 = 8h - 1h de intervalo
    expect(mes1Antes.filter((d) => d.tipo === 'trabalho').every((d) => d.turno === '08:00-16:00')).toBe(true);

    // Férias lançadas no RH antes de gerar o mês 2 continuam lá depois
    const ferias = `${mes2}-10`;
    const f = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: ferias, tipo: 'folga', descricao: 'Férias' } });
    expect(f.ok(), await f.text()).toBeTruthy();
    await gerar(mes2, '10:00-19:00');

    expect(await ajustes(mes1)).toEqual(mes1Antes);
    expect(await horasPrevistas(mes1)).toEqual(horasAntes);
    const mes2Dias = await ajustes(mes2);
    expect(mes2Dias.find((d) => d.data === ferias)).toMatchObject({ tipo: 'folga', descricao: 'Férias' });
    expect(mes2Dias.filter((d) => d.tipo === 'trabalho').every((d) => d.turno === '10:00-19:00')).toBe(true);
    expect(mes2Dias.filter((d) => d.tipo === 'trabalho' && !d.turno)).toHaveLength(0);
  } finally {
    await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
  }
});
