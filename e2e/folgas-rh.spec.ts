import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiBase, authHeaders, CONTAS, loginPelaTela } from './credenciais';

/**
 * Folgas no módulo de RH: só supervisão/administração mudam folgas (a API recusa o colaborador) e o painel
 * "De folga no dia" mostra quem folga e muda a folga para outro dia de trabalho.
 */

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const somarDias = (data: string, dias: number) => new Date(new Date(`${data}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10);

test.describe('RH — folgas', () => {
  test('folga, troca e bloqueio: só supervisão e administração (os 4 papéis)', async ({ request }) => {
    const admin = await authHeaders(request, CONTAS.admin);
    // Profissional próprio do teste: a escala e os bloqueios dele somem quando ele é excluído
    const sufixo = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const criado = await request.post(`${apiBase()}/colaboradores`, {
      headers: admin, data: { nome: `Papeis Folga ${sufixo}`, email: `papeis.${sufixo}@teste.com`, senha: `Provisoria!${sufixo}9`, especialidade: 'Massagem', tipoEscala: '5x2' },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const { id } = await criado.json();
    try {
      const casos = [
        { conta: CONTAS.colaboradora, pode: false },
        { conta: CONTAS.recepcao, pode: false },
        { conta: CONTAS.supervisor, pode: true },
        { conta: CONTAS.admin, pode: true },
      ];
      for (const [n, { conta, pode }] of casos.entries()) {
        const headers = await authHeaders(request, conta);
        const data = somarDias(hojeSP(), 60 + n * 3);
        const override = await request.post(`${apiBase()}/escala/override`, { headers, data: { colaboradorId: id, data, tipo: 'folga' } });
        expect(override.status(), `override ${conta}: ${await override.text()}`).toBe(pode ? 200 : 403);
        const troca = await request.post(`${apiBase()}/escala/swap`, { headers, data: { from: { colaboradorId: id, data }, to: { colaboradorId: id, data: somarDias(data, 1) } } });
        expect(troca.status(), `swap ${conta}: ${await troca.text()}`).toBe(pode ? 200 : 403);
        const bloqueio = await request.post(`${apiBase()}/bloqueios`, { headers, data: { colaboradorId: id, data: somarDias(data, 2), horaInicio: '10:00', horaFim: '11:00', motivo: 'Teste de papéis' } });
        expect(bloqueio.status(), `bloqueio ${conta}: ${await bloqueio.text()}`).toBe(pode ? 201 : 403);
        if (pode) {
          const { id: bloqueioId } = await bloqueio.json();
          expect((await request.delete(`${apiBase()}/bloqueios/${bloqueioId}`, { headers })).ok()).toBeTruthy();
        }
      }
    } finally {
      await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
    }
  });

  test('painel mostra quem está de folga e muda a folga de dia', async ({ page, request }) => {
    const hoje = hojeSP();
    const folga = somarDias(hoje, 1);
    const novo = somarDias(hoje, 2);
    test.skip(folga.slice(0, 7) !== hoje.slice(0, 7) || novo.slice(0, 7) !== hoje.slice(0, 7), 'Fim do mês: sem dias suficientes no mês da grade.');

    const admin = await authHeaders(request, CONTAS.admin);
    // Profissional próprio do teste: os outros testes marcam atendimentos para a equipe do seed, e dia com
    // atendimento não vira folga (409)
    const sufixo = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const criado = await request.post(`${apiBase()}/colaboradores`, {
      headers: admin, data: { nome: `Folga Teste ${sufixo}`, email: `folga.${sufixo}@teste.com`, senha: `Provisoria!${sufixo}9`, especialidade: 'Massagem' },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const helena = (await criado.json()) as { id: string; nome: string };
    const gravar = (data: string, tipo: string) => request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: helena.id, data, tipo, ...(tipo === 'trabalho' ? { turno: '08:00-18:00' } : {}) } });
    try {
      const respFolga = await gravar(folga, 'folga');
      expect(respFolga.ok(), await respFolga.text()).toBeTruthy();
      expect((await gravar(novo, 'trabalho')).ok()).toBeTruthy();

      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
      await page.getByRole('button', { name: /Grade de Escalas/i }).click();

      const painel = page.getByRole('region', { name: 'De folga no dia' });
      await painel.getByLabel('Dia').fill(folga);
      const item = painel.getByRole('listitem').filter({ hasText: helena.nome });
      await expect(item).toBeVisible();
      await item.getByRole('button', { name: 'Mudar folga' }).click();

      const dialogo = page.getByRole('dialog', { name: 'Mudar folga' });
      await dialogo.getByLabel('Novo dia de folga').selectOption({ value: novo });
      await dialogo.getByRole('button', { name: 'Mudar folga' }).click();
      await expect(dialogo).toBeHidden();

      const escala = (await (await request.get(`${apiBase()}/escala/overrides?colaboradorId=${helena.id}&month=${hoje.slice(0, 7)}`, { headers: admin })).json()) as Array<{ data: string; tipo: string }>;
      expect(escala.find((d) => d.data === novo)?.tipo).toBe('folga');
      expect(escala.find((d) => d.data === folga)?.tipo).toBe('trabalho');
      // O painel acompanha: no dia antigo a Helena não está mais de folga
      await expect(item).toBeHidden();
    } finally {
      // Excluir quem nunca atendeu apaga também os dias de escala dele
      await request.delete(`${apiBase()}/colaboradores/${helena.id}`, { headers: admin });
    }
  });
});

test('6x1: segunda folga na mesma semana é recusada; trocar o domingo por trabalho libera', async ({ request }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const sufixo = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  const criado = await request.post(`${apiBase()}/colaboradores`, {
    headers: admin, data: { nome: `Seis Por Um ${sufixo}`, email: `seisx1.${sufixo}@teste.com`, senha: `Provisoria!${sufixo}9`, especialidade: 'Massagem', tipoEscala: '6x1' },
  });
  expect(criado.status(), await criado.text()).toBe(201);
  const { id } = await criado.json();
  // Quarta e domingo da semana que vem (o domingo já é o descanso do 6x1)
  const hoje = new Date(`${hojeSP()}T12:00:00Z`);
  const quarta = somarDias(hojeSP(), ((3 - hoje.getUTCDay() + 7) % 7) + 7);
  const domingo = somarDias(quarta, 4);
  const gravar = (data: string, tipo: string) => request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: id, data, tipo, ...(tipo === 'trabalho' ? { turno: '08:00-17:00' } : {}) } });
  try {
    const recusada = await gravar(quarta, 'folga');
    expect(recusada.status()).toBe(409);
    expect((await recusada.json()).erro).toContain('uma folga por semana');

    expect((await gravar(domingo, 'trabalho')).ok()).toBeTruthy();
    const aceita = await gravar(quarta, 'folga');
    expect(aceita.ok(), await aceita.text()).toBeTruthy();
  } finally {
    await request.delete(`${apiBase()}/colaboradores/${id}`, { headers: admin });
  }
});

// Horário aleatório (HH:MM) para o turno de teste: horário repetido é recusado (409) e duas execuções não colidem
const horarioAleatorio = () => `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(1 + Math.floor(Math.random() * 58)).padStart(2, '0')}`;
const somarHoras = (hhmm: string, horas: number) => `${String((Number(hhmm.slice(0, 2)) + horas) % 24).padStart(2, '0')}${hhmm.slice(2)}`;

// Apaga pela API os turnos de teste com esse nome (limpeza mesmo quando o teste falha no meio)
const apagarTurnosDeTeste = async (request: APIRequestContext, nome: string) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const turnos = (await (await request.get(`${apiBase()}/turnos`, { headers: admin })).json()) as Array<{ id: string; nome: string }>;
  for (const t of turnos.filter((x) => x.nome === nome)) await request.delete(`${apiBase()}/turnos/${t.id}`, { headers: admin });
};

test.describe('RH — turnos padrão', () => {
  test('API: todos leem; só supervisão e administração criam e excluem; horário repetido é recusado', async ({ request }) => {
    const nome = `Turno Papeis ${Date.now() % 100000}`;
    const inicio = horarioAleatorio();
    const fim = somarHoras(inicio, 6);
    try {
      for (const conta of [CONTAS.colaboradora, CONTAS.recepcao, CONTAS.supervisor, CONTAS.admin]) {
        const lidos = await request.get(`${apiBase()}/turnos`, { headers: await authHeaders(request, conta) });
        expect(lidos.status(), conta).toBe(200);
      }
      for (const conta of [CONTAS.colaboradora, CONTAS.recepcao]) {
        expect((await request.post(`${apiBase()}/turnos`, { headers: await authHeaders(request, conta), data: { nome, inicio, fim } })).status(), conta).toBe(403);
      }
      for (const conta of [CONTAS.supervisor, CONTAS.admin]) {
        const headers = await authHeaders(request, conta);
        const criado = await request.post(`${apiBase()}/turnos`, { headers, data: { nome, inicio, fim } });
        expect(criado.status(), `${conta}: ${await criado.text()}`).toBe(201);
        const { id } = await criado.json();
        expect((await request.post(`${apiBase()}/turnos`, { headers, data: { nome: 'Outro', inicio, fim } })).status()).toBe(409);
        expect((await request.post(`${apiBase()}/turnos`, { headers, data: { nome: 'Ruim', inicio: '25:00', fim: '09:00' } })).status()).toBe(400);
        for (const semPermissao of [CONTAS.colaboradora, CONTAS.recepcao]) {
          expect((await request.delete(`${apiBase()}/turnos/${id}`, { headers: await authHeaders(request, semPermissao) })).status(), semPermissao).toBe(403);
        }
        expect((await request.delete(`${apiBase()}/turnos/${id}`, { headers })).status()).toBe(200);
      }
    } finally {
      await apagarTurnosDeTeste(request, nome);
    }
  });

  test('tela: turno criado fica gravado (sobrevive ao recarregar) e só é excluído depois de confirmar', async ({ page, request }) => {
    const nome = `Turno Tela ${Date.now() % 100000}`;
    const inicio = horarioAleatorio();
    try {
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Acessar Módulo RH/i }).click();
      await page.getByRole('button', { name: /Profissionais e Cargos/i }).click();
      await page.getByRole('button', { name: 'Regras e Turnos' }).click();

      const secao = page.getByRole('region', { name: 'Turnos padrão' });
      await secao.getByLabel('Nome').fill(nome);
      await secao.getByLabel('Início').fill(inicio);
      await secao.getByLabel('Fim').fill(somarHoras(inicio, 6));
      // Duplo clique: um turno só e nenhum erro de "horário repetido"
      await secao.getByRole('button', { name: 'Adicionar' }).dblclick();
      await expect(secao.getByRole('row', { name: new RegExp(nome) })).toHaveCount(1);
      await expect(page.getByText('Já existe um turno com esse horário.')).toHaveCount(0);

      await page.reload();
      await page.getByRole('button', { name: 'Regras e Turnos' }).click();
      const linha = page.getByRole('region', { name: 'Turnos padrão' }).getByRole('row', { name: new RegExp(nome) });
      await expect(linha).toBeVisible();
      await linha.getByRole('button', { name: `Excluir turno ${nome}` }).click();
      const confirmacao = page.getByRole('dialog', { name: new RegExp(`Excluir o turno ${nome}`) });
      await confirmacao.getByRole('button', { name: 'Manter turno' }).click();
      await expect(linha).toBeVisible();
      await linha.getByRole('button', { name: `Excluir turno ${nome}` }).click();
      await confirmacao.getByRole('button', { name: 'Excluir', exact: true }).click();
      await expect(linha).toBeHidden();
    } finally {
      await apagarTurnosDeTeste(request, nome);
    }
  });
});
