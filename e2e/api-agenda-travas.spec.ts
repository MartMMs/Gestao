import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { CONTAS, E2E_PASSWORD, apiBase, postLogin } from './credenciais';
import { normalizarNome } from '../shared/validadores';

/**
 * A agenda grava em read committed com travas por chave (backend/lib/transacao.ts). Estes testes provam que cada
 * trava segura a sua regra, sem depender de sorte no tempo: o teste segura a trava do nome de um cliente novo (o
 * "portão"), a requisição A para nele no meio da transação (depois de validar a agenda, antes de gravar), a
 * requisição B é disparada e fica esperando, e só então o portão abre.
 * Caixa-branca: se a ordem das travas mudar (o nome deixar de ser travado depois das validações), estes testes
 * ficam esperando o portão até estourar o tempo.
 */
const urlBanco = process.env.E2E_DATABASE_URL;

async function auth(request: APIRequestContext, email: string) {
  const res = await postLogin(request, { data: { email, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).token}` };
}

const diaFuturo = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
const marca = () => `${Date.now()}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);

// Mesma chave de travarChave (sha256, dois int32), mas como trava de sessão: dura até o teste soltar
const chaveDaTrava = (chave: string) => {
  const digest = crypto.createHash('sha256').update(chave).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)] as const;
};

async function abrirPortao(nomeCliente: string) {
  // Uma conexão só: a trava de sessão precisa ser solta pela mesma conexão que a pegou
  const db = new PrismaClient({ datasourceUrl: `${urlBanco}${urlBanco!.includes('?') ? '&' : '?'}connection_limit=1` });
  const [a, b] = chaveDaTrava(`cliente-nome:${normalizarNome(nomeCliente)}`);
  await db.$executeRaw`SELECT pg_advisory_lock(${a}::integer, ${b}::integer)`;
  const esperandoTrava = async (quantas: number) => {
    await expect.poll(async () => {
      const [{ n }] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
      return n;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(quantas);
  };
  // A parada no portão é conferida pela própria chave: a contagem geral pega esperas de outros testes em paralelo
  const paradaNoPortao = async () => {
    await expect.poll(async () => {
      const [{ n }] = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid::bigint = ${String(a >>> 0)}::bigint AND objid::bigint = ${String(b >>> 0)}::bigint`;
      return n;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  };
  const soltar = async () => {
    await db.$executeRaw`SELECT pg_advisory_unlock(${a}::integer, ${b}::integer)`;
    await db.$disconnect();
  };
  return { paradaNoPortao, esperandoTrava, soltar };
}

async function limparCliente(request: APIRequestContext, headers: Record<string, string>, nomes: string[]) {
  const clientes = (await (await request.get(`${apiBase()}/clientes`, { headers })).json()) as Array<{ id: string; nome: string }>;
  for (const cliente of clientes.filter((c) => nomes.includes(c.nome))) {
    const ags = (await (await request.get(`${apiBase()}/agendamentos?clienteId=${cliente.id}`, { headers })).json()) as Array<{ id: string; atualizadoEm: string; status?: string }>;
    for (const a of ags) await request.delete(`${apiBase()}/agendamentos/${a.id}`, { headers, data: { version: a.atualizadoEm } });
    await request.delete(`${apiBase()}/clientes/${cliente.id}`, { headers });
  }
}

test.describe('API — travas da agenda', () => {
  test.skip(!urlBanco, 'Defina E2E_DATABASE_URL (o banco que a API de testes usa) para rodar estes testes.');

  test('folga marcada enquanto uma marcação do mesmo dia está em andamento: a folga é recusada', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const nome = `Banca Trava Folga ${marca()}`;
    const data = diaFuturo(150 + Math.floor(Math.random() * 30));
    const portao = await abrirPortao(nome);
    try {
      const marcacao = request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: helena!.id, date: data, time: '10:00', serviceNames: ['E2E Massagem'], clientName: nome },
      });
      await portao.paradaNoPortao();
      const folga = request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: helena!.id, data, tipo: 'folga' } });
      // Sem a trava, B não espera: termina antes do portão abrir, e a asserção abaixo mostra o resultado errado
      await Promise.race([portao.esperandoTrava(2), folga]);
      await portao.soltar();
      const [rMarcacao, rFolga] = await Promise.all([marcacao, folga]);
      expect(rMarcacao.status(), await rMarcacao.text()).toBe(201);
      expect(rFolga.status(), await rFolga.text()).toBe(409);
    } finally {
      await portao.soltar().catch(() => {});
      await request.post(`${apiBase()}/escala/override`, { headers: admin, data: { colaboradorId: helena!.id, data, tipo: 'trabalho' } });
      await limparCliente(request, admin, [nome]);
    }
  });

  test('bloqueio criado enquanto uma marcação no mesmo horário está em andamento: o bloqueio é recusado', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const nome = `Banca Trava Bloqueio ${marca()}`;
    const data = diaFuturo(270 + Math.floor(Math.random() * 30));
    const portao = await abrirPortao(nome);
    let bloqueioId: string | undefined;
    try {
      const marcacao = request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: helena!.id, date: data, time: '10:00', serviceNames: ['E2E Massagem'], clientName: nome },
      });
      await portao.paradaNoPortao();
      const bloqueio = request.post(`${apiBase()}/bloqueios`, {
        headers: admin, data: { colaboradorId: helena!.id, data, horaInicio: '09:00', horaFim: '12:00', motivo: 'Teste de trava' },
      });
      // Sem a trava, B não espera: termina antes do portão abrir, e a asserção abaixo mostra o resultado errado
      await Promise.race([portao.esperandoTrava(2), bloqueio]);
      await portao.soltar();
      const [rMarcacao, rBloqueio] = await Promise.all([marcacao, bloqueio]);
      if (rBloqueio.status() === 201) bloqueioId = (await rBloqueio.json()).id;
      expect(rMarcacao.status(), await rMarcacao.text()).toBe(201);
      expect(rBloqueio.status(), await rBloqueio.text()).toBe(409);
    } finally {
      await portao.soltar().catch(() => {});
      if (bloqueioId) await request.delete(`${apiBase()}/bloqueios/${bloqueioId}`, { headers: admin });
      await limparCliente(request, admin, [nome]);
    }
  });

  test('mudança de status durante uma edição já validada: a edição vence e o status é recusado pela versão', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const helena = colabs.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const m = marca();
    const nomeOriginal = `Banca Trava Status ${m}`;
    const nomeNovo = `Banca Trava Status Novo ${m}`;
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin, data: { collaboratorId: helena!.id, date: diaFuturo(185 + Math.floor(Math.random() * 30)), time: '15:00', serviceNames: ['E2E Massagem'], clientName: nomeOriginal },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const ag = await criado.json();
    const portao = await abrirPortao(nomeNovo);
    try {
      const edicao = request.put(`${apiBase()}/agendamentos/${ag.id}`, { headers: admin, data: { clientName: nomeNovo, version: ag.atualizadoEm } });
      await portao.paradaNoPortao();
      const cancelar = request.patch(`${apiBase()}/agendamentos/${ag.id}/status`, { headers: admin, data: { status: 'cancelled', version: ag.atualizadoEm } });
      // Sem a trava, B não espera: termina antes do portão abrir, e a asserção abaixo mostra o resultado errado
      await Promise.race([portao.esperandoTrava(2), cancelar]);
      await portao.soltar();
      const [rEdicao, rCancelar] = await Promise.all([edicao, cancelar]);
      expect(rEdicao.status(), await rEdicao.text()).toBe(200);
      expect(rCancelar.status(), await rCancelar.text()).toBe(409);
      const final = await rEdicao.json();
      expect(final.status ?? 'scheduled').toBe('scheduled');
      expect(final.clienteId).not.toBe(ag.clienteId);
    } finally {
      await portao.soltar().catch(() => {});
      await limparCliente(request, admin, [nomeOriginal, nomeNovo]);
    }
  });

  test('o mesmo cliente pedido para dois profissionais no mesmo horário, ao mesmo tempo: só um grava', async ({ request }) => {
    const admin = await auth(request, CONTAS.admin);
    const colabs = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; papel: string; ativo?: boolean }>;
    const profissionais = colabs.filter((c) => c.papel === 'collaborator' && c.ativo !== false).slice(0, 6);
    test.skip(profissionais.length < 2, 'São precisos 2 profissionais (rode o seed:ci).');
    const nome = `Banca Trava Cliente ${marca()}`;
    const data = diaFuturo(220 + Math.floor(Math.random() * 30));
    // Cadastro criado num outro dia; depois, um pedido por profissional no mesmo horário
    const base = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin, data: { collaboratorId: profissionais[0].id, date: diaFuturo(260), time: '09:00', serviceNames: ['E2E Massagem'], clientName: nome },
    });
    expect(base.status(), await base.text()).toBe(201);
    const { clienteId } = await base.json();
    try {
      const respostas = await Promise.all(profissionais.map((p) => request.post(`${apiBase()}/agendamentos`, {
        headers: admin, data: { collaboratorId: p.id, date: data, time: '14:00', serviceNames: ['E2E Massagem'], clientId: clienteId },
      })));
      expect(respostas.map((r) => r.status()).filter((s) => s === 201)).toHaveLength(1);
    } finally {
      await limparCliente(request, admin, [nome]);
    }
  });
});
