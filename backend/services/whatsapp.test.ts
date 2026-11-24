import { describe, it, expect, vi } from 'vitest';
import { criarWhatsappHttp, criarWhatsappLog, enviarLembretes, filtroLembretes, montarLembrete, type AgendamentoParaLembrete, type WhatsappProvider } from './whatsapp';

const AGORA = new Date('2026-12-10T12:00:00Z');
const ag = (id: string, telefone: string | null = '11987654321'): AgendamentoParaLembrete => ({
  id, data: new Date('2026-12-11T13:30:00Z'), clienteNome: 'Maria Souza', clienteTelefone: telefone,
});

describe('WhatsApp', () => {
  it('provider HTTP envia telefone e mensagem com o token; erro HTTP vira exceção', async () => {
    const buscar = vi.fn(async () => new Response(null, { status: 204 }));
    await criarWhatsappHttp({ url: 'https://wa.test/enviar', token: 'tk' }, buscar).enviar('11987654321', 'Oi');
    const [, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tk');
    expect(JSON.parse(String(init.body))).toEqual({ telefone: '11987654321', mensagem: 'Oi' });

    await expect(criarWhatsappHttp({ url: 'https://wa.test', token: 'tk' }, async () => new Response(null, { status: 500 })).enviar('1', 'x')).rejects.toThrow('500');
  });

  it('modo log não envia nada e não expõe o telefone nem a mensagem', async () => {
    const log = vi.fn();
    const provider = criarWhatsappLog((t) => `(**) *****-**${t.slice(-2)}`, log);
    await provider.enviar('11987654321', 'Lembrete secreto');
    expect(provider.ativo).toBe(false);
    const texto = log.mock.calls[0][0] as string;
    expect(texto).toContain('(**) *****-**21');
    expect(texto).not.toContain('11987654321');
    expect(texto).not.toContain('Lembrete secreto');
  });

  it('lembrete: primeiro nome, data e hora de Brasília, sem nome de serviço', () => {
    expect(montarLembrete({ nome: 'Spa Teste' }, ag('a'))).toBe('*Spa Teste*\nOlá, Maria! Lembrete do seu horário em 11/12/2026 às 10:30. Se não puder vir, avise a recepção.');
  });

  it('lembrete com mensagem da casa: sorteia uma e troca as chaves', () => {
    const empresa = { nome: 'Spa Teste', endereco: 'Rua A, 1', mensagens: ['A {nome}', 'Oi {nome}, {dia da semana} {horario}, reserva {numero da reserva} em {endereco}'] };
    expect(montarLembrete(empresa, ag('abc123'), 0)).toBe('A Maria');
    expect(montarLembrete(empresa, ag('abc123'), 0.99)).toBe('Oi Maria, sexta-feira 10:30, reserva AG-ABC123 em Rua A, 1');
  });

  it('lembrete com confirmação: acrescenta a pergunta 1/2 no fim', () => {
    const texto = montarLembrete({ nome: 'Spa', mensagens: ['Oi {nome}'], pedeConfirmacao: true }, ag('a'), 0);
    expect(texto.startsWith('Oi Maria\n\n*Confirmação de Agendamento*')).toBe(true);
    expect(texto).toContain('*2* (Não poderei ir)');
    expect(montarLembrete({ nome: 'Spa', mensagens: ['Oi {nome}'] }, ag('a'), 0)).toBe('Oi Maria');
  });

  it('job: janela de 2h a 24h, pula sem telefone e já enviados, segue depois de uma falha', async () => {
    const enviar = vi.fn(async (telefone: string) => { if (telefone === '000') throw new Error('falhou'); });
    const provider: WhatsappProvider = { ativo: true, enviar };
    const marcados = new Set(['ja']);
    const buscar = vi.fn(async () => [ag('ja'), ag('sem', null), ag('falha', '000'), ag('ok')]);
    const registrarFalha = vi.fn();

    const enviados = await enviarLembretes({
      provider, empresa: { nome: 'Spa' }, agora: AGORA, buscar, registrarFalha,
      marcarUmaVez: async (id) => (marcados.has(id) ? false : (marcados.add(id), true)),
    });

    expect(buscar).toHaveBeenCalledWith(new Date('2026-12-10T14:00:00Z'), new Date('2026-12-11T12:00:00Z'));
    expect(enviados).toBe(1);
    expect(enviar.mock.calls.map(([telefone]) => telefone)).toEqual(['000', '11987654321']);
    expect(registrarFalha).toHaveBeenCalledWith('falha', expect.any(Error));
    // Rodar de novo não reenvia
    enviar.mockClear();
    await enviarLembretes({ provider, empresa: { nome: 'Spa' }, agora: AGORA, buscar, marcarUmaVez: async (id) => (marcados.has(id) ? false : (marcados.add(id), true)) });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('job: para antes de marcar quando o provider não pode mais enviar (limite diário)', async () => {
    let restam = 1;
    const enviar = vi.fn(async () => { restam -= 1; });
    const marcarUmaVez = vi.fn(async () => true);
    const enviados = await enviarLembretes({
      provider: { ativo: true, enviar, podeEnviar: () => restam > 0 },
      empresa: { nome: 'Spa' }, agora: AGORA, buscar: async () => [ag('a'), ag('b')], marcarUmaVez,
    });
    expect(enviados).toBe(1);
    expect(marcarUmaVez).toHaveBeenCalledTimes(1); // o segundo fica para amanhã, não é perdido
  });

  it('job com confirmação: só pergunta 1/2 por provedor que recebe respostas e quando o número não espera outra resposta', async () => {
    const enviadas: string[] = [];
    const aoEnviar = vi.fn(async (_a: AgendamentoParaLembrete, _perguntou: boolean) => {});
    const provider: WhatsappProvider = { ativo: true, recebeRespostas: true, enviar: async (_t, m) => { enviadas.push(m); } };
    await enviarLembretes({
      provider, empresa: { nome: 'Spa', pedeConfirmacao: true }, agora: AGORA,
      buscar: async () => [ag('livre'), ag('ocupado')],
      marcarUmaVez: async () => true,
      podePerguntar: async (a) => a.id === 'livre',
      aoEnviar,
    });
    expect(enviadas[0]).toContain('responda *1*');
    expect(enviadas[1]).not.toContain('responda *1*');
    expect(aoEnviar.mock.calls.map(([a, perguntou]) => [a.id, perguntou])).toEqual([['livre', true], ['ocupado', false]]);

    // Webhook (não recebe respostas): nunca pergunta
    enviadas.length = 0;
    await enviarLembretes({
      provider: { ativo: true, enviar: async (_t, m) => { enviadas.push(m); } }, empresa: { nome: 'Spa', pedeConfirmacao: true }, agora: AGORA,
      buscar: async () => [ag('x')], marcarUmaVez: async () => true,
    });
    expect(enviadas[0]).not.toContain('responda *1*');
  });

  it('filtro do job: só marcados na janela, sem reserva aguardando pagamento, cliente ativo e com telefone', () => {
    const de = new Date('2026-12-10T14:00:00Z');
    const ate = new Date('2026-12-11T12:00:00Z');
    expect(filtroLembretes(de, ate)).toEqual({
      status: 'scheduled',
      data: { gte: de, lte: ate },
      statusPagamento: { not: 'aguardando_pagamento' },
      cliente: { removidoEm: null, telefone: { not: null }, naoReceberWhatsapp: false },
    });
  });
});
