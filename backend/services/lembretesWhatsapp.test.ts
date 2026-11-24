import { describe, expect, it, vi } from 'vitest';
import { RESPOSTA_NAO, RESPOSTA_SIM } from '../../shared/mensagemLembrete';

// Banco e Redis falsos: o teste passa pelo mesmo caminho do servidor (tratarMensagemRecebida)
const banco = vi.hoisted(() => ({
  updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
  findUnique: vi.fn(async () => ({ data: new Date('2026-11-19T21:15:00Z'), colaboradorId: 'helena', cliente: { nome: 'Maria Cliente' } })),
}));
const redis = vi.hoisted(() => new Map<string, string>());
vi.mock('../db', () => ({
  prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ agendamento: banco }) },
}));
vi.mock('./redisService', () => ({
  redisService: {
    get: async (k: string) => redis.get(k) ?? null,
    set: async (k: string, v: string) => { redis.set(k, v); },
    deleteKey: async (k: string) => { redis.delete(k); return 1; },
  },
}));
const { filtroMarcarAusencia, telefonesDoCliente, tratarMensagemRecebida } = await import('./lembretesWhatsapp');

const eventosFalsos = () => ({ notificarMudanca: vi.fn(), avisarAusencia: vi.fn() });

describe('resposta ao lembrete pelo WhatsApp', () => {
  it('filtro: agendamento marcado, sem aviso anterior, cliente ativo, sem opt-out e com o telefone (com e sem o 9)', () => {
    const filtro = filtroMarcarAusencia('ag1', '62982345678');
    expect(filtro).toMatchObject({ id: 'ag1', status: 'scheduled', clienteAvisouAusenciaEm: null, cliente: { removidoEm: null, naoReceberWhatsapp: false } });
    expect((filtro.cliente as { telefone: { in: string[] } }).telefone.in).toEqual(expect.arrayContaining(['62982345678', '6282345678', '(62) 98234-5678', '(62) 8234-5678', '5562982345678']));
    expect(telefonesDoCliente('(62) 8234-5678')).toContain('62982345678');
  });

  it('"2" vindo do número sem o 9 (conta antiga ou @lid já resolvida): marca a ausência, avisa e responde', async () => {
    redis.set('wa-confirmacao:62982345678', 'ag-amanha'); // lembrete enviado com a pergunta 1/2
    const eventos = eventosFalsos();
    const responder = vi.fn(async () => {});
    await tratarMensagemRecebida(eventos as never)('556282345678@s.whatsapp.net', '2', responder);

    expect(banco.updateMany).toHaveBeenCalledTimes(1);
    const args = banco.updateMany.mock.calls[0][0] as { where: { id: string }; data: { clienteAvisouAusenciaEm: Date } };
    expect(args.where.id).toBe('ag-amanha');
    expect(args.data.clienteAvisouAusenciaEm).toBeInstanceOf(Date);
    // Aviso com o profissional do atendimento (as salas do socket mandam só para recepção, supervisão e ele, nunca admin: eventos.test.ts)
    expect(eventos.avisarAusencia).toHaveBeenCalledWith({ agendamentoId: 'ag-amanha', cliente: 'Maria Cliente', data: '19/11/2026', horario: '18:15', colaboradorId: 'helena' });
    expect(eventos.notificarMudanca).toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(RESPOSTA_NAO);
    expect(redis.has('wa-confirmacao:62982345678')).toBe(false); // não vale duas vezes
  });

  it('"1" (ou o voto "Sim, confirmo"): não mexe na agenda e responde a confirmação', async () => {
    banco.updateMany.mockClear();
    redis.set('wa-confirmacao:62982345678', 'ag-amanha');
    const eventos = eventosFalsos();
    const responder = vi.fn(async () => {});
    await tratarMensagemRecebida(eventos as never)('5562982345678@s.whatsapp.net', '1', responder);
    expect(banco.updateMany).not.toHaveBeenCalled();
    expect(eventos.avisarAusencia).not.toHaveBeenCalled();
    expect(responder).toHaveBeenCalledWith(RESPOSTA_SIM);
  });
});
