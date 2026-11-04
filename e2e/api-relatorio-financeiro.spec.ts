import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { CONTAS, E2E_PASSWORD, postLogin } from './credenciais';

/**
 * Relatório financeiro de ponta a ponta. A API não aceita marcar no passado, então os atendimentos são
 * inseridos direto no banco de testes (E2E_DATABASE_URL, o mesmo da API) num dia isolado de 2020, e as
 * baixas (concluir, reabrir) passam pela API como na tela.
 */
const apiBase = () => process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3333/api';
const urlBanco = process.env.E2E_DATABASE_URL;

async function loginToken(request: APIRequestContext) {
  const res = await postLogin(request, { data: { email: CONTAS.admin, senha: E2E_PASSWORD }, headers: { 'X-Auth-Mode': 'token' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { Authorization: `Bearer ${(await res.json()).token}` };
}

test.describe('API — relatório financeiro com atendimentos de verdade', () => {
  test.skip(!urlBanco, 'Defina E2E_DATABASE_URL (o banco que a API de testes usa) para rodar este teste.');

  test('concluir soma valor e comissão gravados; falta e sem baixa contam à parte; reabrir tira do faturamento', async ({ request }) => {
    const prisma = new PrismaClient({ datasourceUrl: urlBanco });
    const auth = await loginToken(request);
    const sufixo = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Dia isolado: nenhum outro teste usa 2020
    const dia = `2020-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
    const ids: string[] = [];
    let clienteId: string | undefined;
    let servicoId: string | undefined;

    try {
      const helena = await prisma.colaborador.findUnique({ where: { email: CONTAS.colaboradora }, select: { id: true } });
      test.skip(!helena, 'Colaboradora de teste não encontrada (rode o seed:ci).');

      // Serviço criado pela API (preço 100, comissão 10%); o atendimento grava 80 e 8 (valores "da época")
      const criado = await request.post(`${apiBase()}/servicos`, {
        headers: auth, data: { nome: `Banca Relatório ${sufixo}`, preco: 100, duracao: 60, comissaoPercentual: 10 },
      });
      expect(criado.status(), await criado.text()).toBe(201);
      servicoId = (await criado.json()).id as string;
      const cliente = await prisma.cliente.create({ data: { nome: `Banca Relatório ${sufixo}` } });
      clienteId = cliente.id;

      const inserir = (horario: string, status: string) => prisma.agendamento.create({
        data: {
          data: new Date(`${dia}T${horario}:00-03:00`), status, colaboradorId: helena!.id, clienteId: cliente.id,
          servicos: { connect: [{ id: servicoId! }] }, valorTotal: 80, valorComissao: 8, reservaOrigem: 'interno',
        },
      });
      const concluir = await inserir('09:00', 'scheduled');
      const falta = await inserir('11:00', 'no_show');
      const semBaixa = await inserir('14:00', 'scheduled');
      ids.push(concluir.id, falta.id, semBaixa.id);

      const relatorio = async () => {
        const res = await request.get(`${apiBase()}/relatorios/financeiro?de=${dia}&ate=${dia}`, { headers: auth });
        expect(res.ok(), await res.text()).toBeTruthy();
        const corpo = await res.json();
        return { corpo, linha: corpo.profissionais.find((p: { colaboradorId: string }) => p.colaboradorId === helena!.id) };
      };

      // Antes da baixa: os dois agendados vencidos são "sem baixa", a falta é falta, nada faturado
      let { corpo, linha } = await relatorio();
      expect(linha).toMatchObject({ concluidos: 0, faturamento: 0, faltas: 1, semBaixa: 2 });

      // Concluir pela API (com a versão): entra o valor e a comissão gravados, não o preço de hoje
      const concluido = await request.patch(`${apiBase()}/agendamentos/${concluir.id}/status`, {
        headers: auth, data: { status: 'completed', version: concluir.atualizadoEm.toISOString() },
      });
      expect(concluido.status(), await concluido.text()).toBe(200);
      ({ corpo, linha } = await relatorio());
      expect(linha).toMatchObject({ concluidos: 1, faturamento: 80, comissao: corpo.usarComissao ? 8 : 0, faltas: 1, semBaixa: 1 });

      // O detalhe do profissional soma o mesmo que a linha
      const detalhe = await (await request.get(`${apiBase()}/relatorios/financeiro/atendimentos?colaboradorId=${helena!.id}&de=${dia}&ate=${dia}`, { headers: auth })).json();
      expect(detalhe.truncado).toBe(false);
      const soma = detalhe.atendimentos.reduce((t: number, a: { valor: number }) => t + a.valor, 0);
      expect(soma).toBe(linha.faturamento);
      expect(detalhe.atendimentos.map((a: { status: string }) => a.status).sort()).toEqual(['completed', 'no_show', 'sem_baixa']);

      // Concluído não se exclui; reabrir (com a versão) tira do faturamento e fica no histórico
      expect((await request.delete(`${apiBase()}/agendamentos/${concluir.id}`, { headers: auth })).status()).toBe(409);
      const reaberto = await request.patch(`${apiBase()}/agendamentos/${concluir.id}/status`, {
        headers: auth, data: { status: 'scheduled', version: (await concluido.json()).atualizadoEm },
      });
      expect(reaberto.status(), await reaberto.text()).toBe(200);
      ({ linha } = await relatorio());
      expect(linha).toMatchObject({ concluidos: 0, faturamento: 0, faltas: 1, semBaixa: 2 });
    } finally {
      await prisma.agendamento.deleteMany({ where: { id: { in: ids } } });
      if (clienteId) await prisma.cliente.delete({ where: { id: clienteId } }).catch(() => {});
      if (servicoId) await request.delete(`${apiBase()}/servicos/${servicoId}`, { headers: auth });
      await prisma.$disconnect();
    }
  });
});
