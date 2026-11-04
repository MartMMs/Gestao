import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';

/**
 * Regras da agenda que só aparecem com dados de verdade: o mesmo cliente em dois lugares, duas baixas ao mesmo
 * tempo e o profissional mexendo nos serviços depois do início. Atendimentos no passado são inseridos direto no
 * banco de testes (E2E_DATABASE_URL), num dia isolado de 2021 que nenhum outro teste usa.
 */
const urlBanco = process.env.E2E_DATABASE_URL;

async function auth(request: APIRequestContext, email: string) {
  const res = await postLogin(request, { data: { email, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).token}` };
}

const diaFuturo = (dias: number) => {
  const d = new Date(Date.now() + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
};

test.describe('API — regras da agenda', () => {
  test('o mesmo cliente não fica com dois profissionais no mesmo horário', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    const ana = colabs.find((c) => c.email === CONTAS.colaboradoraAlternativa);
    test.skip(!helena || !ana, 'Colaboradoras de teste não encontradas (rode o seed:ci).');
    const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: admin })).json()) as Array<{ nome: string; ativo?: boolean }>;
    // Serviço fixo do seed: os de nome "Banca ..." são criados e apagados por outros testes em paralelo
    const servico = (servicos.find((s) => s.nome === 'E2E Massagem') ?? servicos.find((s) => s.ativo !== false && !s.nome.startsWith('Banca')))?.nome;
    test.skip(!servico, 'Nenhum serviço ativo.');

    const data = diaFuturo(20 + Math.floor(Math.random() * 20));
    const horario = `${String(9 + Math.floor(Math.random() * 6)).padStart(2, '0')}:00`;
    const primeiro = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin,
      data: { collaboratorId: helena!.id, date: data, time: horario, serviceNames: [servico], clientName: `Banca Dois Lugares ${Date.now()}` },
    });
    expect(primeiro.status(), await primeiro.text()).toBe(201);
    const criado = await primeiro.json();
    try {
      const segundo = await request.post(`${apiBase()}/agendamentos`, {
        headers: admin,
        data: { collaboratorId: ana!.id, date: data, time: horario, serviceNames: [servico], clientId: criado.clienteId },
      });
      expect(segundo.status(), await segundo.text()).toBe(409);
      expect((await segundo.json()).erro).toMatch(/Este cliente já tem atendimento/);
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${criado.id}`, { headers: admin, data: { version: criado.atualizadoEm } });
    }
  });

  test('na edição, o profissional não troca o cliente do atendimento digitando outro nome (só a recepção)', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const helena = await auth(request, CONTAS.colaboradora);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = colabs.find((c) => c.email === CONTAS.colaboradora)?.id;
    test.skip(!helenaId, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin,
      data: { collaboratorId: helenaId, date: diaFuturo(41 + Math.floor(Math.random() * 15)), time: '17:00', serviceNames: ['E2E Massagem'], clientName: `Banca Troca ${Date.now()}` },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const ag = await criado.json();
    try {
      const troca = await request.put(`${apiBase()}/agendamentos/${ag.id}`, {
        headers: helena, data: { clientName: `Banca Outro ${Date.now()}`, version: ag.atualizadoEm },
      });
      expect(troca.status(), await troca.text()).toBe(403);
    } finally {
      const atual = await (await request.get(`${apiBase()}/agendamentos?clienteId=${ag.clienteId}`, { headers: admin })).json() as Array<{ id: string; atualizadoEm: string }>;
      for (const a of atual) await request.delete(`${apiBase()}/agendamentos/${a.id}`, { headers: admin, data: { version: a.atualizadoEm } });
      await request.delete(`${apiBase()}/clientes/${ag.clienteId}`, { headers: admin });
    }
  });

  test('profissional sem acesso à ficha: observação vem marcada como oculta e texto novo é recusado (nunca some em silêncio)', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const helena = await auth(request, CONTAS.colaboradora);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helenaId = colabs.find((c) => c.email === CONTAS.colaboradora)?.id;
    const servicos = (await (await request.get(`${apiBase()}/servicos`, { headers: admin })).json()) as Array<{ nome: string; ativo?: boolean }>;
    const servico = (servicos.find((s) => s.nome === 'E2E Massagem') ?? servicos.find((s) => s.ativo !== false && !s.nome.startsWith('Banca')))?.nome;
    test.skip(!helenaId || !servico, 'Dados de teste ausentes (rode o seed:ci).');

    // Marcado pela própria profissional: a reserva dela não libera a ficha de saúde do cliente
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: helena,
      data: { collaboratorId: helenaId, date: diaFuturo(41 + Math.floor(Math.random() * 15)), time: '16:00', serviceNames: [servico], clientName: `Banca Ficha ${Date.now()}`, observation: 'obs na criacao' },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const ag = await criado.json();
    try {
      expect(ag.observacoesSaudeOculta).toBe(true);
      expect(ag.observacoesSaude).toBeNull();
      const tentativa = await request.put(`${apiBase()}/agendamentos/${ag.id}`, {
        headers: helena, data: { observation: 'cliente com alergia a oleo', version: ag.atualizadoEm },
      });
      expect(tentativa.status(), await tentativa.text()).toBe(403);
      expect((await tentativa.json()).erro).toMatch(/não tem acesso à ficha de saúde/);
      // Nem o texto igual ao gravado é aceito: senão daria para confirmar a observação escondida por chute
      const chute = await request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: helena, data: { observation: 'obs na criacao', version: ag.atualizadoEm } });
      expect(chute.status(), await chute.text()).toBe(403);
      // Campo vazio (como a tela manda quando está oculto) não apaga nem dá erro
      const vazio = await request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: helena, data: { observation: '', version: ag.atualizadoEm } });
      expect(vazio.status(), await vazio.text()).toBe(200);
      const lista = (await (await request.get(`${apiBase()}/agendamentos`, { headers: admin })).json()) as Array<{ id: string; observacoesSaude: string | null; atualizadoEm: string }>;
      const atual = lista.find((a) => a.id === ag.id)!;
      expect(atual.observacoesSaude).toBe('obs na criacao');
      ag.atualizadoEm = atual.atualizadoEm;
    } finally {
      await request.delete(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { version: ag.atualizadoEm } });
    }
  });

  test.describe('com atendimentos no passado', () => {
    test.skip(!urlBanco, 'Defina E2E_DATABASE_URL (o banco que a API de testes usa) para rodar estes testes.');

    async function preparar(request: APIRequestContext) {
      const prisma = new PrismaClient({ datasourceUrl: urlBanco });
      const admin = await auth(request, CONTAS.admin);
      const sufixo = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const dia = `2021-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
      const helena = await prisma.colaborador.findUnique({ where: { email: CONTAS.colaboradora }, select: { id: true } });
      const criarServico = async (nome: string) => {
        const res = await request.post(`${apiBase()}/servicos`, { headers: admin, data: { nome: `${nome} ${sufixo}`, preco: 100, duracao: 60, comissaoPercentual: 10 } });
        expect(res.status(), await res.text()).toBe(201);
        return res.json() as Promise<{ id: string; nome: string }>;
      };
      const servico = await criarServico('Banca Regra A');
      const outro = await criarServico('Banca Regra B');
      const cliente = await prisma.cliente.create({ data: { nome: `Banca Regra ${sufixo}` } });
      const ag = await prisma.agendamento.create({
        data: {
          data: new Date(`${dia}T10:00:00-03:00`), status: 'scheduled', colaboradorId: helena!.id, clienteId: cliente.id,
          servicos: { connect: [{ id: servico.id }] }, valorTotal: 100, valorComissao: 10, reservaOrigem: 'interno',
        },
      });
      const limpar = async () => {
        await prisma.agendamento.deleteMany({ where: { id: ag.id } });
        await prisma.cliente.deleteMany({ where: { id: cliente.id } });
        for (const s of [servico, outro]) await request.delete(`${apiBase()}/servicos/${s.id}`, { headers: admin });
        await prisma.$disconnect();
      };
      return { prisma, admin, ag, outro, limpar };
    }

    test('concluir e marcar falta ao mesmo tempo: só uma baixa vale, a outra recebe 409', async ({ request }) => {
      const { prisma, admin, ag, limpar } = await preparar(request);
      try {
        const version = ag.atualizadoEm.toISOString();
        const [concluir, falta] = await Promise.all(['completed', 'no_show'].map((status) =>
          request.patch(`${apiBase()}/agendamentos/${ag.id}/status`, { headers: admin, data: { status, version } })));
        const statusHttp = [concluir.status(), falta.status()].sort();
        expect(statusHttp).toEqual([200, 409]);
        const vencedor = concluir.status() === 200 ? 'completed' : 'no_show';
        expect((await prisma.agendamento.findUniqueOrThrow({ where: { id: ag.id } })).status).toBe(vencedor);
      } finally {
        await limpar();
      }
    });

    test('depois do início, o profissional não troca os serviços (a comissão é dele)', async ({ request }) => {
      const { ag, outro, limpar } = await preparar(request);
      try {
        const helena = await auth(request, CONTAS.colaboradora);
        const res = await request.put(`${apiBase()}/agendamentos/${ag.id}`, {
          headers: helena, data: { serviceNames: [outro.nome], version: ag.atualizadoEm.toISOString() },
        });
        expect(res.status(), await res.text()).toBe(403);
        expect((await res.json()).erro).toMatch(/só a recepção ou a supervisão alteram os serviços/);
      } finally {
        await limpar();
      }
    });
  });
});
