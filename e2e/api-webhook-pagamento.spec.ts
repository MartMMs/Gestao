import { test, expect, type APIRequestContext } from '@playwright/test';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { apiBase, authHeaders, CONTAS } from './credenciais';

/**
 * Webhook do gateway de pagamento (dinheiro): assinatura, busca pela `referencia` aleatória da cobrança, valor
 * conferido, reenvio idempotente e integral depois do sinal. Precisa do mesmo PAYMENT_WEBHOOK_SECRET da API de testes
 * (o CI gera um a cada execução) e do banco dela (E2E_DATABASE_URL) para preparar o agendamento.
 */
const segredo = process.env.PAYMENT_WEBHOOK_SECRET;
const urlBanco = process.env.E2E_DATABASE_URL;

const assinar = (corpo: string, chave: string, ts = Math.floor(Date.now() / 1000)) => ({
  'content-type': 'application/json',
  'x-webhook-timestamp': String(ts),
  'x-webhook-signature': crypto.createHmac('sha256', chave).update(`${ts}.${corpo}`).digest('hex'),
});
const webhook = (request: APIRequestContext, corpo: object, chave = segredo!) => {
  const bruto = JSON.stringify(corpo);
  return request.post(`${apiBase()}/autoatendimento/webhook-pagamento`, { headers: assinar(bruto, chave), data: bruto });
};

test.describe('API — webhook de pagamento', () => {
  test.skip(!segredo || !urlBanco, 'Defina PAYMENT_WEBHOOK_SECRET (o da API de testes) e E2E_DATABASE_URL para rodar este teste.');

  test('referência da cobrança: valor menor 422, sinal pago, reenvio sem efeito, integral depois, desconhecida 404, assinatura errada 401', async ({ request }) => {
    const prisma = new PrismaClient({ datasourceUrl: urlBanco });
    const admin = await authHeaders(request, CONTAS.admin);
    const nome = `Webhook Teste ${Math.random().toString(36).slice(2, 8)}`;
    const equipe = (await (await request.get(`${apiBase()}/colaboradores`, { headers: admin })).json()) as Array<{ id: string; email?: string }>;
    const profissional = equipe.find((c) => c.email === CONTAS.colaboradora);
    test.skip(!profissional, 'Colaboradora de teste não encontrada (rode o seed:ci).');
    const data = new Date(Date.now() + (300 + Math.floor(Math.random() * 30)) * 86_400_000).toISOString().slice(0, 10);
    const criado = await request.post(`${apiBase()}/agendamentos`, {
      headers: admin, data: { collaboratorId: profissional!.id, date: data, time: '10:00', serviceNames: ['E2E Massagem'], clientName: nome },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const { id, clienteId } = (await criado.json()) as { id: string; clienteId: string };
    const referencia = crypto.randomUUID();
    try {
      // Como o totem deixa a reserva com pagamento online: aguardando, com a referência que o gateway recebeu
      await prisma.agendamento.update({ where: { id }, data: { referenciaPagamento: referencia, statusPagamento: 'aguardando_pagamento', valorSinal: 50, valorTotal: 100 } });

      expect((await webhook(request, { event: 'payment.succeeded', referencia, valorPago: 49, tipo: 'sinal' })).status()).toBe(422);
      const sinal = await webhook(request, { event: 'payment.succeeded', referencia, valorPago: 50, tipo: 'sinal' });
      expect(sinal.status(), await sinal.text()).toBe(200);
      expect(await sinal.json()).toMatchObject({ atualizado: true });
      expect((await prisma.agendamento.findUnique({ where: { id } }))?.statusPagamento).toBe('sinal_pago');
      expect(await (await webhook(request, { event: 'payment.succeeded', referencia, valorPago: 50, tipo: 'sinal' })).json()).toMatchObject({ atualizado: false });
      expect(await (await webhook(request, { event: 'payment.succeeded', referencia, valorPago: 50, tipo: 'integral' })).json()).toMatchObject({ atualizado: true });

      expect((await webhook(request, { event: 'payment.succeeded', referencia: crypto.randomUUID(), valorPago: 50, tipo: 'sinal' })).status()).toBe(404);
      // id e referência de agendamentos diferentes: recusado
      expect((await webhook(request, { event: 'payment.succeeded', agendamentoId: id, referencia: crypto.randomUUID(), valorPago: 50, tipo: 'sinal' })).status()).toBe(404);
      expect((await webhook(request, { event: 'payment.succeeded', referencia, valorPago: 50, tipo: 'sinal' }, 'segredo-errado')).status()).toBe(401);
    } finally {
      await prisma.agendamento.update({ where: { id }, data: { servicos: { set: [] } } }).catch(() => {});
      await prisma.agendamento.deleteMany({ where: { id } });
      await prisma.cliente.deleteMany({ where: { id: clienteId, nome } });
      await prisma.$disconnect();
    }
  });
});
