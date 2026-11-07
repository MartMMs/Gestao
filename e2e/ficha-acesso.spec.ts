import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders, diaFuturo, loginPelaTela, nomeClienteTeste } from './credenciais';

const JSON_FICHA = '__ANAMNESE_JSON__:{"alergia":"Lavanda"}';
type ClienteApi = { id: string; nome: string; observacao: string | null; temAnamnese: boolean; acessoSaude?: boolean };

const lista = async (request: APIRequestContext, conta: string) =>
  (await (await request.get(`${apiBase()}/clientes`, { headers: await authHeaders(request, conta) })).json()) as ClienteApi[];

const gravarObs = async (id: string, observacao: string) => {
  const db = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  try { await db.cliente.update({ where: { id }, data: { observacao } }); } finally { await db.$disconnect(); }
};

test.describe('Ficha: acessoSaude e privacidade por papel (API)', () => {
  test('supervisão/admin: true; recepção: vê telefone completo e atualiza ficha sem ver saúde; profissional: vê ficha nos próximos 7 dias (inclusive agendamento próprio) e recebe 403 fora da janela', async ({ request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco de testes');
    test.setTimeout(120_000);
    const sup = await authHeaders(request, CONTAS.supervisor);
    const recH = await authHeaders(request, CONTAS.recepcao);
    const helenaH = await authHeaders(request, CONTAS.colaboradora);
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: await authHeaders(request, CONTAS.admin) })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = equipe.find((e) => e.email === CONTAS.colaboradora)!.id;
    const perto = nomeClienteTeste('BancaTeste Perto');
    const longe = nomeClienteTeste('BancaTeste Longe');
    const proprio = nomeClienteTeste('BancaTeste Proprio');
    const marcar = async (headers: Record<string, string>, corpo: Record<string, unknown>, dias: number[]) => {
      for (const d of dias) for (const h of ['08:00', '19:00', '12:00', '15:00', '10:00']) {
        const r = await request.post(`${apiBase()}/agendamentos`, { headers, data: { collaboratorId: helenaId, date: diaFuturo(d), time: h, serviceNames: ['E2E Massagem'], ...corpo } });
        if (r.status() === 201) return r.json();
      }
      throw new Error(`sem horário: ${JSON.stringify(corpo)}`);
    };
    try {
      expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome: perto, telefone: '(11) 98888-7766', cpf: '52998224725' }, { nome: longe }], confirmar: true } })).status()).toBe(201);
      const todos = await lista(request, CONTAS.supervisor);
      const cPerto = todos.find((c) => c.nome === perto)!;
      const cLonge = todos.find((c) => c.nome === longe)!;
      await marcar(sup, { clientId: cPerto.id }, [1, 2, 3, 4]);
      await marcar(sup, { clientId: cLonge.id }, [12, 13, 14, 15]);
      // Agendamento criado pela própria Helena nos próximos 7 dias: libera a ficha para ela executar o serviço (A3)
      const ag = await marcar(helenaH, { clientName: proprio }, [2, 3, 4, 5]);
      for (const id of [cPerto.id, cLonge.id, ag.clienteId]) await gravarObs(id, `nota clinica\n${JSON_FICHA}`);

      const daHelena = await lista(request, CONTAS.colaboradora);
      const h = (id: string) => daHelena.find((c) => c.id === id);
      expect(h(cPerto.id)?.acessoSaude, 'perto').toBe(true);
      expect(h(cPerto.id)?.observacao).toContain('Lavanda');
      expect((h(cPerto.id) as { telefone?: string })?.telefone, 'colaboradora vê telefone mascarado').toMatch(/^\(\*\*\) \*\*\*\*\*-\*\*66$/);
      expect(h(cLonge.id)?.acessoSaude, 'longe (>7 dias)').toBe(false);
      expect(h(cLonge.id)?.observacao ?? null).toBeNull();
      // Colaboradora tentando editar cliente fora da janela recebe 403 (corrige IDOR Item 1)
      const idor = await request.put(`${apiBase()}/clientes/${cLonge.id}`, { headers: helenaH, data: { observacao: `nota\n__ANAMNESE_JSON__:{"alergia":"Cravo"}` } });
      expect(idor.status()).toBe(403);

      expect(h(ag.clienteId)?.acessoSaude, 'agendado por ela mesma nos próximos 7 dias').toBe(true);
      expect(h(ag.clienteId)?.observacao).toContain('Lavanda');
      expect(h(ag.clienteId)?.temAnamnese).toBe(true);

      for (const conta of [CONTAS.supervisor, CONTAS.admin]) {
        const l = await lista(request, conta);
        expect(l.every((c) => c.acessoSaude === true), conta).toBe(true);
      }
      const rec = await lista(request, CONTAS.recepcao);
      expect(rec.every((c) => c.acessoSaude === false), 'recepção').toBe(true);
      const recPerto = rec.find((c) => c.id === cPerto.id) as { telefone?: string; cpf?: string } | undefined;
      // A1: Recepção vê telefone completo para ligar ao cliente, mas CPF segue mascarado
      expect(recPerto?.telefone).toBe('(11) 98888-7766');
      expect(recPerto?.cpf).toBe('***.***.***-25');

      // A2: Recepção atualiza a ficha no balcão sem ver a nota médica anterior e sem apagá-la
      const attRec = await request.put(`${apiBase()}/clientes/${cLonge.id}`, {
        headers: recH,
        data: { observacao: `__ANAMNESE_JSON__:{"alergia":"Camomila"}` },
      });
      expect(attRec.status(), await attRec.text()).toBe(200);
      expect((await attRec.json()).observacao).toBeNull();
      const posRec = (await lista(request, CONTAS.supervisor)).find((c) => c.id === cLonge.id)!;
      expect(posRec.observacao).toContain('nota clinica');
      expect(posRec.observacao).toContain('Camomila');

      // Coerência: sem acesso => sem conteúdo, em todos os papéis
      for (const [conta, l] of [['recepção', rec], ['helena', daHelena]] as const) {
        const vazou = l.filter((c) => !c.acessoSaude && c.observacao != null).map((c) => c.nome);
        expect(vazou, conta).toEqual([]);
      }
    } finally {
      await apagarClienteDeTeste(request, [perto, longe, proprio]);
    }
  });
});


test.describe('Ficha: U+2028 numa ficha real', () => {
  test('ficha com U+2028 num campo aparece no resumo da lista', async ({ page, request }) => {
    test.skip(!process.env.E2E_DATABASE_URL, 'precisa do banco de testes');
    const nome = nomeClienteTeste('BancaTeste Quebra');
    const sup = await authHeaders(request, CONTAS.supervisor);
    expect((await request.post(`${apiBase()}/clientes/importar`, { headers: sup, data: { linhas: [{ nome }], confirmar: true } })).status()).toBe(201);
    const c = (await lista(request, CONTAS.supervisor)).find((x) => x.nome === nome)!;
    try {
      // Pela API normal (PUT da supervisão), como a tela gravaria um texto colado
      const r = await request.put(`${apiBase()}/clientes/${c.id}`, { headers: sup, data: { observacao: `nota\n__ANAMNESE_JSON__:${JSON.stringify({ alergia: 'Lavanda\u2028Rosa', queixa: 'lombar' })}` } });
      expect(r.status(), await r.text()).toBe(200);
      expect((await lista(request, CONTAS.supervisor)).find((x) => x.id === c.id)?.temAnamnese).toBe(true);
      await page.goto('/');
      await loginPelaTela(page, CONTAS.supervisor);
      await page.getByRole('button', { name: /Clientes$/ }).first().click();
      await page.getByLabel('Buscar cliente').fill(nome);
      await page.getByRole('row', { name: new RegExp(nome) }).getByRole('button', { name: nome, exact: true }).click();
      const resumo = page.getByRole('dialog', { name: /Resumo da ficha de anamnese/i });
      await expect(resumo.getByText('Queixa: lombar')).toBeVisible();
    } finally {
      await apagarClienteDeTeste(request, nome);
    }
  });
});
