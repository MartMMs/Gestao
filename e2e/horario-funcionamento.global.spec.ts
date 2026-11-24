import { test, expect, type APIRequestContext } from '@playwright/test';
import { CONTAS, apiBase, authHeaders, loginPelaTela } from './credenciais';

// Mudam o horário da empresa toda: projeto configuracao-global, em série, e o original volta no fim
test.describe.configure({ mode: 'serial' });

type DiaEspecial = { data: string; fechado: boolean; abertura?: string | null; fechamento?: string | null; motivo?: string | null };
type Horario = { horaAbertura: string; horaFechamento: string; horaLimiteAgendamento: string | null; diasFuncionamento: number[]; diasEspeciais?: DiaEspecial[] };
let original: Horario;

const gravar = async (request: APIRequestContext, dados: Partial<Horario> & { confirmarForaDoHorario?: boolean }, conta: string = CONTAS.admin) =>
  request.put(`${apiBase()}/empresa/config`, { headers: await authHeaders(request, conta), data: dados });

// Grava confirmando (o banco de testes pode ter atendimentos de outras specs fora do horário de teste)
const gravarConfirmando = async (request: APIRequestContext, dados: Partial<Horario>, conta?: string) => {
  const r = await gravar(request, { ...dados, confirmarForaDoHorario: true }, conta);
  expect(r.ok(), await r.text()).toBeTruthy();
};

// Próxima data (a partir de 3 dias) que cai no dia da semana pedido (0 = domingo), no fuso de Brasília
const proximo = (diaSemana: number, aPartirDe = 3) => {
  for (let n = aPartirDe; ; n += 1) {
    const data = new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    if (new Date(`${data}T12:00:00Z`).getUTCDay() === diaSemana) return data;
  }
};

const helenaId = async (request: APIRequestContext) => {
  const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email: string }>;
  return equipe.find((c) => c.email === CONTAS.colaboradora)!.id;
};

const marcar = async (request: APIRequestContext, date: string, time: string) => request.post(`${apiBase()}/agendamentos`, {
  headers: await authHeaders(request, CONTAS.admin),
  data: { collaboratorId: await helenaId(request), date, time, serviceNames: ['E2E Massagem'], clientName: `Horario Casa ${Date.now()}` },
});

const apagar = async (request: APIRequestContext, ag: { id: string; clienteId: string }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin });
  await request.delete(`${apiBase()}/clientes/${ag.clienteId}`, { headers: admin });
};

test.beforeAll(async ({ request }) => {
  const r = await request.get(`${apiBase()}/empresa/config`);
  expect(r.ok(), 'ler o horário original para devolver no fim').toBeTruthy();
  const c = await r.json();
  original = { horaAbertura: c.horaAbertura, horaFechamento: c.horaFechamento, horaLimiteAgendamento: c.horaLimiteAgendamento, diasFuncionamento: c.diasFuncionamento, diasEspeciais: c.diasEspeciais ?? [] };
  expect(original.horaAbertura && original.horaFechamento && Array.isArray(original.diasFuncionamento), JSON.stringify(original)).toBeTruthy();
});
test.afterAll(async ({ request }) => gravarConfirmando(request, original));

test('API: horário inválido e recepção são recusados; agendamento e remarcação respeitam dias, limite e fechamento', async ({ request }) => {
  expect((await gravar(request, { horaAbertura: '10:00', horaFechamento: '18:00', horaLimiteAgendamento: '18:30' })).status()).toBe(400);
  expect((await gravar(request, { horaAbertura: '10:10', horaFechamento: '18:00' })).status()).toBe(400);
  expect((await gravar(request, { diasFuncionamento: [] })).status()).toBe(400);
  expect((await gravar(request, { diasFuncionamento: ['a'] as unknown as number[] })).status()).toBe(400);
  expect((await gravar(request, { horaFechamento: '19:00' }, CONTAS.recepcao)).status()).toBe(403);

  // Aberto todos os dias para marcar um atendimento num dia de semana
  await gravarConfirmando(request, { horaAbertura: '09:00', horaFechamento: '21:00', horaLimiteAgendamento: null, diasFuncionamento: [0, 1, 2, 3, 4, 5, 6] });
  const criado = await marcar(request, proximo(3), '11:00');
  expect(criado.status(), await criado.text()).toBe(201);
  const ag = await criado.json() as { id: string; clienteId: string; atualizadoEm: string };
  try {
    await gravarConfirmando(request, { horaAbertura: '10:00', horaFechamento: '18:00', horaLimiteAgendamento: '16:00', diasFuncionamento: [1, 2, 3, 4, 5, 6] }, CONTAS.supervisor);

    const domingo = await marcar(request, proximo(0), '11:00');
    expect(domingo.status()).toBe(400);
    expect((await domingo.json()).erro).toBe('A casa não abre aos domingos.');
    const depoisDoLimite = await marcar(request, proximo(3), '16:30');
    expect(depoisDoLimite.status()).toBe(400);
    expect((await depoisDoLimite.json()).erro).toMatch(/entre 10:00 e 16:00/);
    expect((await marcar(request, proximo(3), '09:30')).status()).toBe(400);

    // Remarcar para o domingo ou depois do limite também é recusado
    const admin = await authHeaders(request, CONTAS.admin);
    const paraDomingo = await request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { date: proximo(0), time: '11:00', version: ag.atualizadoEm } });
    expect(paraDomingo.status()).toBe(400);
    const paraDepois = await request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { time: '17:00', version: ag.atualizadoEm } });
    expect(paraDepois.status()).toBe(400);
  } finally {
    await apagar(request, ag);
  }
});

test('API: mudar o horário com atendimento marcado fora dele pede confirmação', async ({ request }) => {
  await gravarConfirmando(request, { horaAbertura: '09:00', horaFechamento: '21:00', horaLimiteAgendamento: null, diasFuncionamento: [0, 1, 2, 3, 4, 5, 6] });
  const criado = await marcar(request, proximo(3), '19:00');
  expect(criado.status(), await criado.text()).toBe(201);
  const ag = await criado.json();
  try {
    const semConfirmar = await gravar(request, { horaFechamento: '18:00' });
    expect(semConfirmar.status()).toBe(409);
    const corpo = await semConfirmar.json();
    expect(corpo.code).toBe('FORA_DO_HORARIO');
    expect(corpo.quantidade).toBeGreaterThanOrEqual(1);
    expect((await (await request.get(`${apiBase()}/empresa/config`)).json()).horaFechamento).toBe('21:00'); // nada gravado

    await gravarConfirmando(request, { horaFechamento: '18:00' });
    expect((await (await request.get(`${apiBase()}/empresa/config`)).json()).horaFechamento).toBe('18:00');
  } finally {
    await apagar(request, ag);
  }
});

test('totem: só oferece horários dentro do expediente e explica o dia fechado', async ({ request }) => {
  await gravarConfirmando(request, { horaAbertura: '10:15', horaFechamento: '18:00', horaLimiteAgendamento: '16:00', diasFuncionamento: [1, 2, 3, 4, 5, 6] });
  const servicos = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as { id: string; nome: string }[];
  const servicoId = (servicos.find((s) => s.nome === 'E2E Massagem') ?? servicos[0]).id;
  const disponibilidade = async (data: string) =>
    (await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${data}&servicoIds=${servicoId}`)).json();

  const diaDeSemana = await disponibilidade(proximo(3, 5));
  const horarios = (diaDeSemana.slots as { horario: string }[]).map((s) => s.horario);
  expect(horarios.length).toBeGreaterThan(0);
  expect(horarios[0]).toBe('10:30'); // abertura 10:15 alinhada aos 30 min do totem
  expect(horarios.every((h) => h >= '10:30' && h <= '16:00')).toBeTruthy();

  const domingo = await disponibilidade(proximo(0, 5));
  expect(domingo.slots).toEqual([]);
  expect(domingo.mensagem).toBe('Não abrimos aos domingos.');
});

test('tela: supervisão muda o horário, o administrador vê o mesmo e salvar a empresa não apaga o horário', async ({ page, browser, request }) => {
  await gravarConfirmando(request, { horaAbertura: '09:00', horaFechamento: '21:00', horaLimiteAgendamento: null, diasFuncionamento: [1, 2, 3, 4, 5, 6] });
  await page.goto('/');
  await loginPelaTela(page, CONTAS.supervisor);
  await page.getByRole('button', { name: /Totem & Autoatendimento/i }).click();
  const cartao = page.getByRole('form', { name: 'Horário de funcionamento' });
  await expect(cartao.getByRole('button', { name: 'Nada alterado' })).toBeDisabled();
  await cartao.getByLabel('Fechamento').fill('22:00');
  await cartao.getByRole('button', { name: 'domingo' }).click(); // abre aos domingos
  await cartao.getByRole('button', { name: 'Salvar horário' }).click();
  await expect(cartao.getByRole('status')).toContainText('Horário de funcionamento salvo');

  const contexto = await browser.newContext();
  try {
    const admin = await contexto.newPage();
    await admin.goto('/');
    await loginPelaTela(admin, CONTAS.admin);
    await admin.getByRole('button', { name: /Empresa & Segmento/i }).click();
    const doAdmin = admin.getByRole('form', { name: 'Horário de funcionamento' });
    await expect(doAdmin.getByLabel('Fechamento')).toHaveValue('22:00');
    await expect(doAdmin.getByRole('button', { name: 'domingo' })).toHaveAttribute('aria-pressed', 'true');

    // O formulário da empresa (outra parte da mesma config) não regrava uma cópia antiga do horário
    await gravarConfirmando(request, { horaFechamento: '20:00' });
    await admin.getByRole('button', { name: /Salvar Configurações da Empresa/i }).click();
    await expect.poll(async () => (await (await request.get(`${apiBase()}/empresa/config`)).json()).horaFechamento).toBe('20:00');
  } finally {
    await contexto.close();
  }
});

test('dias especiais: data fechada, horário próprio e domingo aberto valem no totem e na agenda', async ({ request }) => {
  const [quarta, quinta, domingo] = [proximo(3, 5), proximo(4, 5), proximo(0, 5)];
  await gravarConfirmando(request, {
    horaAbertura: '09:00', horaFechamento: '18:00', horaLimiteAgendamento: null, diasFuncionamento: [1, 2, 3, 4, 5, 6],
    diasEspeciais: [
      { data: quarta, fechado: true, motivo: 'Inventário' },
      { data: quinta, fechado: false, abertura: '10:00', fechamento: '14:00' },
      { data: domingo, fechado: false, abertura: '09:00', fechamento: '12:00' },
    ],
  });
  const config = await (await request.get(`${apiBase()}/empresa/config`)).json();
  expect(config.diasEspeciais).toHaveLength(3); // a config pública leva os dias especiais

  const servicos = await (await request.get(`${apiBase()}/autoatendimento/servicos`)).json() as { id: string; nome: string }[];
  const servicoId = (servicos.find((s) => s.nome === 'E2E Massagem') ?? servicos[0]).id;
  const totem = async (data: string) => (await request.get(`${apiBase()}/autoatendimento/disponibilidade?data=${data}&servicoIds=${servicoId}`)).json();
  const br = (d: string) => d.split('-').reverse().join('/');

  const fechado = await totem(quarta);
  expect(fechado.slots).toEqual([]);
  expect(fechado.mensagem).toBe(`A casa estará fechada em ${br(quarta)} (Inventário).`);
  const curto = (await totem(quinta)).slots.map((s: { horario: string }) => s.horario);
  expect(curto[0]).toBe('10:00');
  expect(curto.every((h: string) => h >= '10:00' && h < '14:00')).toBeTruthy();
  expect((await totem(domingo)).slots.length).toBeGreaterThan(0); // domingo normalmente fechado, aberto só nessa data

  // Agenda da equipe: recusa a data fechada e o horário depois do fechamento especial
  const naQuarta = await marcar(request, quarta, '11:00');
  expect(naQuarta.status()).toBe(400);
  expect((await naQuarta.json()).erro).toContain(`fechada em ${br(quarta)}`);
  const tardeNaQuinta = await marcar(request, quinta, '15:00');
  expect(tardeNaQuinta.status()).toBe(400);
  const manhaNaQuinta = await marcar(request, quinta, '10:00');
  expect(manhaNaQuinta.status(), await manhaNaQuinta.text()).toBe(201);
  await apagar(request, await manhaNaQuinta.json());

  // Data inválida é recusada
  const invalido = await gravar(request, { diasEspeciais: [{ data: quinta, fechado: false, abertura: '14:00', fechamento: '10:00' }] });
  expect(invalido.status()).toBe(400);
});

test('tela: supervisão fecha uma data pelo cartão de horário', async ({ page, request }) => {
  await gravarConfirmando(request, { horaAbertura: '09:00', horaFechamento: '21:00', horaLimiteAgendamento: null, diasFuncionamento: [1, 2, 3, 4, 5, 6], diasEspeciais: [] });
  const data = proximo(2, 20);
  await page.goto('/');
  await loginPelaTela(page, CONTAS.supervisor);
  await page.getByRole('button', { name: /Totem & Autoatendimento/i }).click();
  const cartao = page.getByRole('form', { name: 'Horário de funcionamento' });
  await cartao.getByLabel('Data').fill(data);
  await cartao.getByRole('button', { name: 'Adicionar dia' }).click();
  const lista = cartao.getByRole('list', { name: 'Dias especiais' });
  await expect(lista.getByText(data.split('-').reverse().join('/'))).toBeVisible();
  await lista.getByRole('textbox').fill('Inventário');
  await cartao.getByRole('button', { name: /Salvar/ }).click();
  await expect(cartao.getByRole('status')).toContainText('Horário de funcionamento salvo');
  await expect.poll(async () => (await (await request.get(`${apiBase()}/empresa/config`)).json()).diasEspeciais)
    .toEqual([{ data, fechado: true, abertura: null, fechamento: null, motivo: 'Inventário' }]);
});
