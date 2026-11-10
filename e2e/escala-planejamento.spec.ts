import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, loginPelaTela } from './credenciais';

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
    headers: admin, data: { nome, email: `escala.${s}@teste.com`, senha: `Provisoria!${s}9`, especialidade: 'Massagem' },
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
      page.once('dialog', (d) => d.accept()); // "sair sem salvar" do modal
      await dialogo.getByRole('button', { name: 'Fechar' }).click();
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

  test('Padrão 12x36: pede confirmação, vira proposta e só grava em "Confirmar Escala"', async ({ page, request }) => {
    const nome = `Escala Modelo ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await abrirGrade(page, nome);
      await page.getByRole('button', { name: /Padrão 12x36/ }).click();
      await page.getByRole('button', { name: 'Montar proposta' }).click();
      expect(await ajustesSalvos(request, id)).toHaveLength(0); // proposta ainda não gravada

      await page.getByRole('button', { name: /Confirmar Escala/ }).click();
      await expect(page.getByRole('button', { name: 'Descartar Proposta' })).toBeHidden({ timeout: 60_000 }); // gravou tudo
      expect((await ajustesSalvos(request, id)).length).toBeGreaterThan(5);
      const salvos = await ajustesSalvos(request, id);
      for (const ajuste of salvos.filter((a) => a.tipo === 'trabalho')) expect(ajuste.turno).toBe('07:00-19:00');

      // Recarregar não perde nada: está no servidor
      await page.reload();
      await expect.poll(async () => (await ajustesSalvos(request, id)).length).toBe(salvos.length);
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

test.describe('Grade de Escalas: propostas, troca e teclado', () => {
  test('Descartar Proposta volta a tela ao que está salvo e não grava nada', async ({ page, request }) => {
    const nome = `Escala Descarte ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await abrirGrade(page, nome);
      const antes = await dia(page, 10).getAttribute('aria-label');
      await page.getByRole('button', { name: /Padrão 12x36/ }).click();
      await page.getByRole('button', { name: 'Montar proposta' }).click();
      await expect(dia(page, 10)).not.toHaveAttribute('aria-label', antes!); // proposta aparece na grade
      await page.getByRole('button', { name: 'Descartar Proposta' }).click();
      await expect(page.getByRole('button', { name: 'Descartar Proposta' })).toBeHidden();
      await expect(dia(page, 10)).toHaveAttribute('aria-label', antes!);
      await page.reload();
      expect(await ajustesSalvos(request, id)).toHaveLength(0);
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
      await page.getByRole('button', { name: /Repetir Mês Anterior/ }).click();
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

  test('trocar dias tocando em dois dias pede confirmação e grava a troca', async ({ page, request }) => {
    const nome = `Escala Troca ${sufixo()}`;
    const id = await criarColaborador(request, nome);
    try {
      await gravarDia(request, id, data(12), 'folga');
      await gravarDia(request, id, data(13), 'trabalho');
      await abrirGrade(page, nome);
      await page.getByRole('button', { name: /Editar Grade/ }).click();
      await dia(page, 12).click();
      await expect(page.getByText(/Dia 12 escolhido/)).toBeVisible();
      await dia(page, 13).click();
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
