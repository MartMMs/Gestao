import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, descartarAlteracoes, loginPelaTela } from './credenciais';

/**
 * Grade de Escalas: editar um dia, editar vários (arrastando), lote com falha no meio e os modelos (12x36),
 * conferindo o que ficou gravado na API. Usa o mês que vem: todos os dias ainda podem ser alterados.
 */

const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const [ano, mesAtual] = hoje.split('-').map(Number);
const proximo = new Date(Date.UTC(ano, mesAtual, 1, 12)); // mês que vem (Date.UTC conta o mês a partir de 0)
const mes = proximo.toISOString().slice(0, 7);
const data = (dia: number) => `${mes}-${String(dia).padStart(2, '0')}`;

const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

const criarColaborador = async (request: APIRequestContext, nome: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const s = sufixo();
  const r = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome, email: `escala.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem', tipoEscala: '5x2' },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as string;
};

const trabalharNos = async (request: APIRequestContext, id: string, dias: number[]) => {
  const admin = await authHeaders(request, CONTAS.admin);
  for (const n of dias) {
    const r = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: data(n), tipo: 'trabalho', turno: '08:00-18:00' } });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
};

const ajustesSalvos = async (request: APIRequestContext, id: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const r = await request.get(`${apiBase()}/escala/overrides?colaboradorId=${id}&month=${mes}`, { headers: admin });
  return (await r.json()) as Array<{ data: string; tipo: string; turno?: string | null; descricao?: string | null }>;
};

const abrirGrade = async (page: Page, nome: string) => {
  await page.goto('/');
  await loginPelaTela(page, CONTAS.supervisor);
  await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
  await page.getByRole('button', { name: /Grade de Escalas/i }).click();
  await page.getByRole('complementary', { name: 'Colaboradores da escala' }).getByRole('button', { name: new RegExp(nome) }).click();
  await page.getByTitle('Próximo mês').click();
};

// Célula do calendário pelo nome acessível ("15 de dezembro. Comercial, ...")
const dia = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^${n} de [^.]+\\.`) });

const arrastar = async (page: Page, de: number, ate: number) => {
  await dia(page, ate).scrollIntoViewIfNeeded(); // caixas medidas na tela: o mouse precisa achar as células
  const caixas = [];
  for (let n = de; n <= ate; n += 1) caixas.push((await dia(page, n).boundingBox())!);
  await page.mouse.move(caixas[0].x + 10, caixas[0].y + 10);
  await page.mouse.down();
  for (const caixa of caixas.slice(1)) await page.mouse.move(caixa.x + 10, caixa.y + 10, { steps: 3 });
  await page.mouse.up();
};

// Um teste por vez neste arquivo (mesmo worker, em ordem): em paralelo entre si, estes testes de tela pesados
// disputavam CPU e banco e estouravam o tempo. 'default' em vez de 'serial': uma falha não pula os seguintes
test.describe.configure({ mode: 'default' });

test.describe('Grade de Escalas', () => {
  test('um dia: abre pelo clique e não salva sem mudança', async ({ page, request }) => {
    const nome = `Escala Dia ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await trabalharNos(request, id, [15]); // independe do ciclo (domingo de folga)
      await abrirGrade(page, nome);
      await dia(page, 15).click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo.getByRole('button', { name: 'Nada alterado' })).toBeDisabled();
      await dialogo.getByRole('button', { name: 'Folga' }).click();
      await dialogo.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(dialogo).toBeHidden();
      await expect.poll(async () => (await ajustesSalvos(request, id)).find((a) => a.data === data(15))?.tipo).toBe('folga');
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });

  test('vários dias: só o que mudou é aplicado; folga e observação de cada dia ficam', async ({ page, request }) => {
    const nome = `Escala Lote ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    const admin = await authHeaders(request, CONTAS.admin);
    try {
      await trabalharNos(request, id, [15, 17]);
      const folga = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: data(16), tipo: 'folga', descricao: 'Consulta médica' } });
      expect(folga.ok(), await folga.text()).toBeTruthy();

      await abrirGrade(page, nome);
      await arrastar(page, 15, 17);
      const dialogo = page.getByRole('dialog');
      await dialogo.getByLabel('Observações (opcional)').fill('Cobertura de recepção');
      await dialogo.getByRole('button', { name: 'Aplicar nos 3 dias' }).click();
      await expect(dialogo).toBeHidden();

      await expect.poll(async () => (await ajustesSalvos(request, id)).filter((a) => a.descricao === 'Cobertura de recepção').length).toBe(3);
      const salvos = await ajustesSalvos(request, id);
      expect(salvos.find((a) => a.data === data(16))?.tipo).toBe('folga'); // não virou trabalho
      expect(salvos.find((a) => a.data === data(15))?.tipo).toBe('trabalho');
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('vários dias com falha no último: diz quantos salvou e a tela bate com o servidor', async ({ page, request }) => {
    const nome = `Escala Parcial ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    const admin = await authHeaders(request, CONTAS.admin);
    let agendamento: { id: string; clienteId: string } | null = null;
    try {
      // Dia de trabalho em todos (independe do ciclo) e um atendimento no último: folga ali é recusada pela API
      await trabalharNos(request, id, [15, 16, 17]);
      const a = await request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: id, date: data(17), time: '10:00', serviceNames: ['E2E Massagem'], clientName: `Escala Cliente ${sufixo()}` },
      });
      expect(a.status(), await a.text()).toBe(201);
      agendamento = await a.json();

      await abrirGrade(page, nome);
      await arrastar(page, 15, 17);
      const dialogo = page.getByRole('dialog');
      await dialogo.getByRole('button', { name: 'Folga' }).click();
      await dialogo.getByRole('button', { name: 'Aplicar nos 3 dias' }).click();

      await expect(dialogo.getByText(/Salvos 2 de 3 dias/)).toBeVisible();
      const salvos = await ajustesSalvos(request, id);
      expect([15, 16, 17].map((n) => salvos.find((s) => s.data === data(n))?.tipo)).toEqual(['folga', 'folga', 'trabalho']);
      await dialogo.getByRole('button', { name: 'Fechar' }).click();
      await descartarAlteracoes(page); // "sair sem salvar" do modal
      await expect(dia(page, 15)).toHaveAccessibleName(/Folga/);
      await expect(dia(page, 17)).not.toHaveAccessibleName(/Folga/);
    } finally {
      if (agendamento) {
        await request.delete(`${apiBase()}/agendamentos/${agendamento.id}`, { headers: admin });
        await request.delete(`${apiBase()}/clientes/${agendamento.clienteId}`, { headers: admin });
      }
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('barra principal sem Padrão 12x36 nem Editar Grade; filtros e ações ficam nos menus compactos', async ({ page, request }) => {
    const nome = `Escala Barra ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await abrirGrade(page, nome);
      await expect(page.getByRole('button', { name: /Padrão 12x36/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Editar Grade/i })).toHaveCount(0);
      await page.getByRole('button', { name: /Filtros/i }).click();
      await expect(page.getByLabel('Status', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Turno', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Carga Semanal', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /Ações/i }).click();
      await expect(page.getByRole('button', { name: /Repetir mês anterior/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Edição em lote/i })).toBeVisible();
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});

// Mês daqui a k meses (1 = o que vem)
const mesDaqui = (k: number) => new Date(Date.UTC(ano, mesAtual - 1 + k, 1, 12)).toISOString().slice(0, 7);
const ajustesDoMes = async (request: APIRequestContext, id: string, m: string) => {
  const r = await request.get(`${apiBase()}/escala/overrides?colaboradorId=${id}&month=${m}`, { headers: await authHeaders(request, CONTAS.admin) });
  return (await r.json()) as Array<{ data: string; tipo: string }>;
};
const gravarDia = async (request: APIRequestContext, id: string, dataDia: string, tipo: 'trabalho' | 'folga') => {
  const r = await request.post(`${apiBase()}/escala/override`, {
    headers: await authHeaders(request, CONTAS.admin),
    data: { colaboradorId: id, data: dataDia, tipo, ...(tipo === 'trabalho' ? { turno: '08:00-18:00' } : {}) },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
};

const abrirRepetirMesAnterior = async (page: Page) => {
  await page.getByRole('button', { name: /Ações/i }).click();
  await page.getByRole('button', { name: /Repetir mês anterior/i }).click();
};

test.describe('Grade de Escalas: propostas, troca e teclado', () => {
  test('Descartar Proposta volta a tela ao que está salvo e não grava nada', async ({ page, request }) => {
    const nome = `Escala Descarte ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      const [m1, m2] = [mesDaqui(1), mesDaqui(2)];
      await gravarDia(request, id, `${m1}-14`, 'folga');
      const alvoDia = Number(new Date(Date.UTC(Number(m1.slice(0, 4)), Number(m1.slice(5)) - 1, 14 + 28, 12)).toISOString().slice(8, 10));
      await abrirGrade(page, nome);
      await page.getByTitle('Próximo mês').click(); // daqui a dois meses
      const antes = await dia(page, alvoDia).getAttribute('aria-label');
      await abrirRepetirMesAnterior(page);
      await page.getByRole('button', { name: 'Montar proposta' }).click();
      await expect(dia(page, alvoDia)).not.toHaveAttribute('aria-label', antes!); // proposta aparece na grade
      await page.getByRole('button', { name: 'Descartar Proposta' }).click();
      await expect(page.getByRole('button', { name: 'Descartar Proposta' })).toBeHidden();
      await expect(dia(page, alvoDia)).toHaveAttribute('aria-label', antes!);
      await page.reload();
      expect(await ajustesDoMes(request, id, m2)).toHaveLength(0);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });

  test('Repetir Mês Anterior leva o ajuste 28 dias adiante, só depois de confirmar', async ({ page, request }) => {
    const nome = `Escala Repetir ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      const [m1, m2] = [mesDaqui(1), mesDaqui(2)];
      await gravarDia(request, id, `${m1}-14`, 'folga');
      await abrirGrade(page, nome);
      await page.getByTitle('Próximo mês').click(); // daqui a dois meses
      await abrirRepetirMesAnterior(page);
      await page.getByRole('button', { name: 'Montar proposta' }).click();
      expect(await ajustesDoMes(request, id, m2)).toHaveLength(0);
      await page.getByRole('button', { name: /Confirmar Escala/ }).click();
      await expect(page.getByRole('button', { name: 'Descartar Proposta' })).toBeHidden({ timeout: 60_000 });
      const alvo = new Date(Date.UTC(Number(m1.slice(0, 4)), Number(m1.slice(5)) - 1, 14 + 28, 12)).toISOString().slice(0, 10);
      expect((await ajustesDoMes(request, id, m2)).map((a) => [a.data, a.tipo])).toEqual([[alvo, 'folga']]);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });

  test('trocar dias arrastando na Timeline pede confirmação e grava a troca', async ({ page, request }) => {
    const nome = `Escala Troca ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await gravarDia(request, id, data(12), 'folga');
      await gravarDia(request, id, data(13), 'trabalho');
      await abrirGrade(page, nome);
      await page.getByRole('button', { name: 'view_timeline Timeline' }).click();
      const celula12 = page.getByTitle(new RegExp(`^${nome} \\| 12/`));
      const celula13 = page.getByTitle(new RegExp(`^${nome} \\| 13/`));
      await celula12.dragTo(celula13);
      await expect(page.getByRole('dialog')).toContainText(nome);
      await page.getByRole('button', { name: 'Trocar', exact: true }).click();
      await expect.poll(async () => {
        const salvos = await ajustesSalvos(request, id);
        return [12, 13].map((n) => salvos.find((a) => a.data === data(n))?.tipo).join(',');
      }).toBe('trabalho,folga');
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });

  test('Shift + clique seleciona o intervalo; Esc fecha sem gravar; Enter abre pelo teclado', async ({ page, request }) => {
    const nome = `Escala Teclado ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await abrirGrade(page, nome);
      const dialogo = page.getByRole('dialog');
      await dia(page, 5).click();
      await expect(dialogo).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialogo).toBeHidden();
      await dia(page, 8).click({ modifiers: ['Shift'] });
      await expect(dialogo).toContainText('4 dias selecionados');
      await page.keyboard.press('Escape');
      await expect(dialogo).toBeHidden();
      await dia(page, 3).focus();
      await page.keyboard.press('Enter');
      await expect(dialogo).toBeVisible();
      expect(await ajustesSalvos(request, id)).toHaveLength(0);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});

test.describe('Grade de Escalas: edição direta na Timeline', () => {
  test('clicar num dia abre o editor direto sem trava Editar Grade: fechar não grava, salvar grava', async ({ page, request }) => {
    const nome = `Escala Timeline ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await trabalharNos(request, id, [15]);
      await abrirGrade(page, nome);
      await page.getByRole('button', { name: 'view_timeline Timeline' }).click();
      const celula = page.getByTitle(new RegExp(`^${nome} \\| 15/`));
      await celula.click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo).toBeVisible();
      await dialogo.getByRole('button', { name: 'Fechar' }).click();
      await expect(dialogo).toBeHidden();
      expect((await ajustesSalvos(request, id)).find((a) => a.data === data(15))?.tipo).toBe('trabalho');

      await celula.click();
      await dialogo.getByRole('button', { name: 'Folga' }).click();
      await dialogo.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(dialogo).toBeHidden();
      await expect.poll(async () => (await ajustesSalvos(request, id)).find((a) => a.data === data(15))?.tipo).toBe('folga');
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});

test.describe('Grade de Escalas: replicar na Timeline', () => {
  const ultimoDia = new Date(Date.UTC(ano, mesAtual + 1, 0, 12)).getUTCDate(); // último dia do mês que vem
  const abrirTimelineEditando = async (page: Page, nome: string) => {
    await abrirGrade(page, nome);
    await page.getByRole('group', { name: 'Visualização da escala' }).getByRole('button', { name: /Timeline/i }).click();
  };
  const replicar = async (page: Page, nome: string, n: number) => {
    const celula = page.getByTitle(new RegExp(`^${nome} \\| ${String(n).padStart(2, '0')}/`));
    await celula.scrollIntoViewIfNeeded();
    await celula.hover();
    await page.getByRole('button', { name: `Replicar o dia ${n} de ${nome} até o fim do mês` }).click();
  };

  test('pede confirmação; cancelar não grava; confirmar grava até o fim do mês com o turno da origem', async ({ page, request }) => {
    const nome = `Escala Replicar ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    const admin = await authHeaders(request, CONTAS.admin);
    try {
      const r = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: data(20), tipo: 'trabalho', turno: '09:00-15:00' } });
      expect(r.ok(), await r.text()).toBeTruthy();
      await abrirTimelineEditando(page, nome);

      await replicar(page, nome, 20);
      const dialogo = page.getByRole('dialog').filter({ hasText: 'Replicar este dia?' });
      await expect(dialogo).toContainText('09:00 às 15:00');
      await dialogo.getByRole('button', { name: 'Cancelar' }).click();
      expect(await ajustesSalvos(request, id)).toHaveLength(1);

      await replicar(page, nome, 20);
      await page.getByRole('button', { name: 'Replicar', exact: true }).click();
      await expect.poll(async () => (await ajustesSalvos(request, id)).length).toBe(ultimoDia - 20 + 1);
      const salvos = await ajustesSalvos(request, id);
      expect(salvos.every((a) => a.tipo === 'trabalho' && a.turno === '09:00-15:00')).toBe(true);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('atendimento no meio (409): nada é gravado e a tela volta ao que era', async ({ page, request }) => {
    const nome = `Escala Replicar409 ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    const admin = await authHeaders(request, CONTAS.admin);
    let agendamento: { id: string; clienteId: string } | null = null;
    try {
      const folga = await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data: data(20), tipo: 'folga' } });
      expect(folga.ok(), await folga.text()).toBeTruthy();
      await trabalharNos(request, id, [25]);
      const a = await request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: id, date: data(25), time: '10:00', serviceNames: ['E2E Massagem'], clientName: `Escala Cliente ${sufixo()}` },
      });
      expect(a.status(), await a.text()).toBe(201);
      agendamento = await a.json();

      await abrirTimelineEditando(page, nome);
      const celula25 = page.getByTitle(new RegExp(`^${nome} \\| 25/`));
      const antes = await celula25.getAttribute('title');
      await replicar(page, nome, 20);
      await page.getByRole('button', { name: 'Replicar', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Realoque-os antes de marcar folga');
      await expect(celula25).toHaveAttribute('title', antes!);
      expect((await ajustesSalvos(request, id)).map((s) => s.tipo).sort()).toEqual(['folga', 'trabalho']);
    } finally {
      if (agendamento) {
        await request.delete(`${apiBase()}/agendamentos/${agendamento.id}`, { headers: admin });
        await request.delete(`${apiBase()}/clientes/${agendamento.clienteId}`, { headers: admin });
      }
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('dia que ainda é proposta não é replicado', async ({ page, request }) => {
    const nome = `Escala ReplicarProposta ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      const [m1, m2] = [mesDaqui(1), mesDaqui(2)];
      await gravarDia(request, id, `${m1}-14`, 'folga');
      const alvoDia = Number(new Date(Date.UTC(Number(m1.slice(0, 4)), Number(m1.slice(5)) - 1, 14 + 28, 12)).toISOString().slice(8, 10));
      await abrirGrade(page, nome);
      await page.getByTitle('Próximo mês').click(); // daqui a dois meses
      await abrirRepetirMesAnterior(page);
      await page.getByRole('button', { name: 'Montar proposta' }).click();
      await page.getByRole('button', { name: 'view_timeline Timeline' }).click();
      await replicar(page, nome, alvoDia);
      await expect(page.getByText(/ainda é uma proposta não gravada/)).toBeVisible();
      await expect(page.getByRole('dialog').filter({ hasText: 'Replicar este dia?' })).toHaveCount(0);
      expect(await ajustesDoMes(request, id, m2)).toHaveLength(0);
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: await authHeaders(request, CONTAS.admin) });
    }
  });
});

test('API: a semana que comporta 45h de trabalho gera alerta da CLT ao gravar', async ({ request }) => {
  const id = await criarColaborador(request, `Escala Alerta ${sufixo()}`);
  const admin = await authHeaders(request, CONTAS.admin);
  try {
    let segunda = 8;
    while (new Date(`${data(segunda)}T12:00:00Z`).getUTCDay() !== 1) segunda += 1;
    let resposta: { alertasClt?: string[] } = {};
    for (let n = segunda; n < segunda + 6; n += 1) {
      const r = await request.post(`${apiBase()}/escala/override`, {
        headers: admin, data: { colaboradorId: id, data: data(n), tipo: 'trabalho', turno: n < segunda + 3 ? '08:00-18:00' : '08:00-14:30' },
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      resposta = await r.json();
    }
    expect((resposta.alertasClt || []).some((a) => /45h/.test(a)), JSON.stringify(resposta.alertasClt)).toBe(true);
  } finally {
    await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
  }
});
