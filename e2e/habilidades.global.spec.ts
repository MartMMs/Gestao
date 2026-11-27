import { test, expect, type APIRequestContext } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

/**
 * Pacote 2: habilidades cadastradas, serviço "por habilidade" e a chave global "exigir habilidades" (sempre, só no
 * totem, desligado). Muda configuração global da empresa: roda no projeto configuracao-global, em série, e volta a
 * chave para "sempre" (padrão) no fim. Helena recebe a habilidade; Ana não (e vem antes no alfabeto, então com a
 * exigência desligada é ela que o totem oferece primeiro).
 */
test.describe.configure({ mode: 'serial' });

type Slot = { horario: string; disponivel: boolean; terapeuta?: { id: string } };
const sufixo = Date.now().toString(36);
const NOME_HABILIDADE = `E2E Pedras ${sufixo}`;
const NOME_SERVICO = `E2E Hab ${sufixo}`;
const clientes: string[] = [];

let admin: Record<string, string>;
let habilidadeId = '';
let servicoId = '';
let helenaId = '';
let anaId = '';
let data = '';

const exigencia = async (request: APIRequestContext, valor: 'sempre' | 'apenas_totem' | 'desligado') => {
  // Login novo a cada troca: a sessão do admin pode cair durante os testes de tela
  const r = await request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, CONTAS.admin), data: { exigenciaHabilidades: valor } });
  expect(r.status(), await r.text()).toBe(200);
};
const slots = async (request: APIRequestContext) => {
  const r = await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${data}&servicoIds=${servicoId}`);
  expect(r.status(), await r.text()).toBe(200);
  const corpo = await r.json() as { slots?: Slot[] } | Slot[];
  return (Array.isArray(corpo) ? corpo : corpo.slots ?? []).filter((s) => s.disponivel && s.terapeuta);
};
const agendar = async (request: APIRequestContext, colaboradorId: string, horario: string, headers: Record<string, string>) => {
  const clientName = nomeClienteTeste('Hab Agenda');
  clientes.push(clientName);
  return request.post(`${apiBase()}/agendamentos`, {
    headers, data: { collaboratorId: colaboradorId, date: data, time: horario, serviceNames: [NOME_SERVICO], clientName },
  });
};

test.beforeAll(async ({ request }) => {
  admin = await authHeaders(request, CONTAS.admin);
  const equipe = await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json() as Array<{ id: string; email: string }>;
  helenaId = equipe.find((c) => c.email === CONTAS.colaboradora)!.id;
  anaId = equipe.find((c) => c.email === CONTAS.colaboradoraAlternativa)!.id;

  // 1. Admin cria a habilidade, um serviço que a exige e vincula só a Helena
  const hab = await request.post(`${apiBase()}/habilidades`, { headers: admin, data: { nome: NOME_HABILIDADE } });
  expect(hab.status(), await hab.text()).toBe(201);
  habilidadeId = (await hab.json()).id;
  const dup = await request.post(`${apiBase()}/habilidades`, { headers: admin, data: { nome: `  ${NOME_HABILIDADE.toUpperCase()} ` } });
  expect(dup.status(), 'nome repetido (sem diferenciar maiúsculas)').toBe(409);
  const srv = await request.post(`${apiBase()}/servicos`, {
    headers: admin, data: { nome: NOME_SERVICO, preco: 10, duracao: 30, modoElegibilidade: 'por_habilidade', habilidadeIds: [habilidadeId] },
  });
  expect(srv.status(), await srv.text()).toBe(201);
  servicoId = (await srv.json()).id;
  const vinc = await request.put(`${apiBase()}/colaboradores/${helenaId}`, { headers: admin, data: { habilidadeIds: [habilidadeId] } });
  expect(vinc.status(), await vinc.text()).toBe(200);
  expect((await vinc.json()).habilidades).toContain(NOME_HABILIDADE);

  // Um dia em que as duas trabalham: com a exigência desligada, a Ana (primeira no alfabeto) aparece no totem
  await exigencia(request, 'desligado');
  for (let d = 3; d <= 20 && !data; d++) {
    data = diaFuturo(d);
    const livres = await slots(request);
    if (!(livres.some((s) => s.terapeuta!.id === anaId) && livres.length > 2)) data = '';
  }
  expect(data, 'dia com a Ana e a Helena livres').not.toBe('');
});

test.afterAll(async ({ request }) => {
  await exigencia(request, 'sempre');
  admin = await authHeaders(request, CONTAS.admin);
  if (servicoId) await apagarClienteDeTeste(request, clientes);
  if (servicoId) await request.delete(`${apiBase()}/servicos/${servicoId}`, { headers: admin });
  if (helenaId) await request.put(`${apiBase()}/colaboradores/${helenaId}`, { headers: admin, data: { habilidadeIds: [] } });
  if (habilidadeId) await request.patch(`${apiBase()}/habilidades/${habilidadeId}/arquivar`, { headers: admin });
});

test('sempre: o totem só oferece a profissional habilitada e a agenda recusa quem não tem (422)', async ({ request }) => {
  await exigencia(request, 'sempre');
  const livres = await slots(request);
  expect(livres.length).toBeGreaterThan(0);
  expect(new Set(livres.map((s) => s.terapeuta!.id))).toEqual(new Set([helenaId]));
  // O catálogo público não leva as regras internas de quem atende
  const catalogo = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as Array<Record<string, unknown>>;
  const publico = catalogo.find((s) => s.id === servicoId)!;
  for (const campo of ['habilidadesPermitidas', 'habilidadeIds', 'habilidadesExigidas', 'cargosPermitidos', 'profissionaisPermitidos', 'habilidadesPermitidasLegado']) {
    expect(publico, campo).not.toHaveProperty(campo);
  }
  const recusado = await agendar(request, anaId, livres[0].horario, await authHeaders(request, CONTAS.recepcao));
  expect(recusado.status(), await recusado.text()).toBe(422);
  expect((await recusado.json()).erro).toMatch(/habilidade/);
});

test('desligado: libera os demais profissionais no totem e na agenda, sem aviso', async ({ request }) => {
  await exigencia(request, 'desligado');
  const livres = await slots(request);
  const daAna = livres.find((s) => s.terapeuta!.id === anaId);
  expect(daAna, 'Ana oferecida no totem').toBeTruthy();
  const criado = await agendar(request, anaId, daAna!.horario, await authHeaders(request, CONTAS.recepcao));
  expect(criado.status(), await criado.text()).toBe(201);
  expect(await criado.json()).not.toHaveProperty('avisoHabilidade');
});

test('só no totem: o totem barra, a recepção agenda com aviso (API e tela)', async ({ request, page }) => {
  await exigencia(request, 'apenas_totem');
  const livres = await slots(request);
  expect(new Set(livres.map((s) => s.terapeuta!.id))).toEqual(new Set([helenaId]));
  const criado = await agendar(request, anaId, livres[livres.length - 1].horario, await authHeaders(request, CONTAS.recepcao));
  expect(criado.status(), await criado.text()).toBe(201);
  expect((await criado.json()).avisoHabilidade).toMatch(/habilidade/);

  // Tela: a habilitada vem primeiro e a Ana aparece depois, marcada; escolhê-la mostra o aviso amarelo
  await page.goto('/');
  await loginPelaTela(page, CONTAS.recepcao);
  await page.getByRole('button', { name: /Nova reserva/i }).click();
  const modal = page.getByRole('dialog', { name: /Novo Agendamento/i });
  await modal.getByRole('button', { name: /Novo Cliente/i }).click();
  await modal.getByPlaceholder('Nome completo').fill(nomeClienteTeste('Hab Tela'));
  await modal.getByRole('button', { name: new RegExp(NOME_SERVICO) }).first().click();
  const seletor = modal.locator('select').filter({ has: page.locator(`option[value="${anaId}"]`) });
  const opcoes = await seletor.locator('option').allTextContents();
  const posHelena = opcoes.findIndex((o) => o.startsWith('Helena E2E'));
  const posAna = opcoes.findIndex((o) => o.startsWith('Ana E2E'));
  expect(posHelena).toBeGreaterThanOrEqual(0);
  expect(posAna).toBeGreaterThan(posHelena);
  expect(opcoes[posAna]).toContain('sem habilidade');
  await seletor.selectOption(anaId);
  await expect(modal.getByRole('status').filter({ hasText: 'não tem a habilidade exigida' })).toBeVisible();
});

test('arquivar habilidade vinculada mostra o impacto antes de confirmar', async ({ page, request }) => {
  admin = await authHeaders(request, CONTAS.admin);
  await page.goto('/');
  await loginPelaTela(page, CONTAS.admin);
  await page.getByRole('button', { name: /Equipe & Papéis/i }).click();
  await page.getByRole('button', { name: 'Habilidades', exact: true }).click();
  const linha = page.getByRole('region', { name: 'Habilidades cadastradas' }).getByRole('group', { name: NOME_HABILIDADE });
  await linha.getByRole('button', { name: 'Arquivar' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText(NOME_HABILIDADE);
  await expect(dialogo).toContainText('1 serviço(s) ativo(s) exigem esta habilidade');
  await dialogo.getByRole('button', { name: 'Manter ativa' }).click();
  // Nada mudou; pela API o arquivamento devolve os serviços afetados e não apaga a habilidade
  const lista = await (await request.get(`${apiBase()}/habilidades`, { headers: admin })).json() as Array<{ id: string }>;
  expect(lista.some((h) => h.id === habilidadeId)).toBe(true);
  const arq = await request.patch(`${apiBase()}/habilidades/${habilidadeId}/arquivar`, { headers: admin });
  expect(arq.status()).toBe(200);
  expect(await arq.json()).toMatchObject({ totalServicosAfetados: 1, servicosAfetados: [{ id: servicoId, nome: NOME_SERVICO }] });
  const todas = await (await request.get(`${apiBase()}/habilidades?incluirArquivadas=true`, { headers: admin })).json() as Array<{ id: string; ativa: boolean }>;
  expect(todas.find((h) => h.id === habilidadeId)?.ativa).toBe(false);
  const reativada = await request.put(`${apiBase()}/habilidades/${habilidadeId}`, { headers: admin, data: { ativa: true } });
  expect(reativada.status(), await reativada.text()).toBe(200);
});

test('recepção e colaborador: 403 nas habilidades e no Módulo RH; só a recepção lê a escala operacional', async ({ request }) => {
  const id = habilidadeId;
  for (const conta of [CONTAS.recepcao, CONTAS.colaboradora]) {
    const h = await authHeaders(request, conta);
    const chamadas = [
      request.get(`${apiBase()}/habilidades`, { headers: h }),
      request.post(`${apiBase()}/habilidades`, { headers: h, data: { nome: 'Invasora' } }),
      request.put(`${apiBase()}/habilidades/${id}`, { headers: h, data: { nome: 'Invasora' } }),
      request.patch(`${apiBase()}/habilidades/${id}/arquivar`, { headers: h }),
      request.get(`${apiBase()}/turnos`, { headers: h }),
      request.post(`${apiBase()}/turnos`, { headers: h, data: { nome: 'X', inicio: '08:00', fim: '12:00' } }),
      request.get(`${apiBase()}/escala/overrides`, { headers: h }),
      request.post(`${apiBase()}/escala/override`, { headers: h, data: {} }),
      request.post(`${apiBase()}/escala/swap`, { headers: h, data: {} }),
      request.post(`${apiBase()}/escala/replicate`, { headers: h, data: {} }),
      request.post(`${apiBase()}/escala/ausencia/remover`, { headers: h, data: {} }),
      request.put(`${apiBase()}/empresa/config`, { headers: h, data: { exigenciaHabilidades: 'desligado' } }),
    ];
    const status = await Promise.all(chamadas.map(async (c) => (await c).status()));
    expect(status, conta).toEqual(status.map(() => 403));
  }
  expect((await request.get(`${apiBase()}/escala/operacional`, { headers: await authHeaders(request, CONTAS.recepcao) })).status()).toBe(200);
  expect((await request.get(`${apiBase()}/escala/operacional`, { headers: await authHeaders(request, CONTAS.colaboradora) })).status()).toBe(403);
});
