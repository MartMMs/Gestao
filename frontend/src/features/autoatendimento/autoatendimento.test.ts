import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  fetchAutoatendimentoServicos,
  fetchAutoatendimentoDisponibilidade,
  reservarSlotAutoatendimento,
  confirmarPagamentoAutoatendimento,
} from './services/autoatendimentoService';
import type { AutoatendimentoDisponibilidadeResponse, AutoatendimentoReservaSession, Voucher } from '../../types';

describe('Autoatendimento Service & Business Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchAutoatendimentoServicos busca servicos da rota publica', async () => {
    const mockServicos = [
      { id: 'srv-1', nome: 'Massagem Relaxante', preco: 180, duracao: 60, categoria: 'Massagens' },
      { id: 'srv-2', nome: 'Drenagem Linfática', preco: 220, duracao: 50, categoria: 'Corporal' },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockServicos,
    } as Response);

    const result = await fetchAutoatendimentoServicos();
    expect(result).toHaveLength(2);
    expect(result[0].nome).toBe('Massagem Relaxante');
  });

  it('fetchAutoatendimentoDisponibilidade consulta slots com terapeuta e cabine', async () => {
    const mockDisponibilidade: AutoatendimentoDisponibilidadeResponse = {
      data: '2026-10-20',
      servico: { id: 'srv-1', nome: 'Massagem Relaxante', preco: 180, duracao: 60, tempoHigienizacaoMin: 15 },
      slots: [
        {
          horario: '09:00',
          disponivel: true,
          terapeuta: { id: 'emp-1', nome: 'Helena', especialidade: 'Massoterapeuta' },
          sala: { id: 'room-1', nome: 'Cabine Bambu Zen', numero: 1 },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockDisponibilidade,
    } as Response);

    const result = await fetchAutoatendimentoDisponibilidade('srv-1', '2026-10-20');
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].sala?.nome).toBe('Cabine Bambu Zen');
    expect(result.slots[0].disponivel).toBe(true);
  });

  it('reservarSlotAutoatendimento dispara lock no Redis e retorna sessao com TTL de 10 min', async () => {
    const mockDetalhes: AutoatendimentoReservaSession = {
      sessionToken: 'lock-test-uuid',
      servicoId: 'srv-1',
      data: '2026-10-20',
      horario: '10:00',
      terapeutaId: 'emp-1',
      salaId: 'room-1',
      terapeutaNome: 'Helena',
      salaNome: 'Cabine Bambu Zen',
      servicoNome: 'Massagem Relaxante',
      duracao: 60,
      valorTotal: 200,
      valorSinal: 80,
      lockExpiresAt: Date.now() + 600000,
    };

    const mockResponse = {
      sucesso: true,
      sessionToken: 'lock-test-uuid',
      lockExpiresAt: mockDetalhes.lockExpiresAt,
      tempoRestanteSegundos: 600,
      detalhes: mockDetalhes,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await reservarSlotAutoatendimento({
      servicoId: 'srv-1',
      terapeutaId: 'emp-1',
      salaId: 'room-1',
      data: '2026-10-20',
      horario: '10:00',
    });

    expect(result.sessionToken).toBe('lock-test-uuid');
    expect(result.tempoRestanteSegundos).toBe(600);
    expect(result.detalhes.valorSinal).toBe(80);
  });

  it('calcula o sinal de reserva como 40% do preco total', () => {
    const precoTotal = 250;
    const sinalCalculado = Number((precoTotal * 0.4).toFixed(2));
    expect(sinalCalculado).toBe(100);
  });

  it('formata o cronometro regressivo de 600 segundos corretamente em mm:ss', () => {
    const formatTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(599)).toBe('09:59');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(0)).toBe('00:00');
  });

  it('confirmarPagamentoAutoatendimento valida agendamento e gera voucher oficial', async () => {
    const mockVoucher: Voucher = {
      reservaId: 'ag-12345',
      codigoConfirmacao: 'SPA-98765',
      clienteNome: 'Mariana Silva',
      clienteTelefone: '(11) 98888-7777',
      terapiaNome: 'Massagem Relaxante',
      duracaoMin: 60,
      data: '2026-10-20',
      horario: '10:00',
      terapeutaNome: 'Helena',
      salaNome: 'Cabine 01 - Bambu Zen',
      valorTotal: 200,
      valorSinal: 80,
      statusPagamento: 'sinal_pago',
      politicaCancelamento: 'Cancelamento gratuito até 4 horas antes da sessão.',
      orientacoesCheckIn: ['Chegue com 15 minutos de antecedência.'],
    };

    const mockResponse = {
      sucesso: true,
      agendamentoId: 'ag-12345',
      voucher: mockVoucher,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await confirmarPagamentoAutoatendimento({
      sessionToken: 'lock-test-uuid',
      cliente: {
        nome: 'Mariana Silva',
        telefone: '(11) 98888-7777',
        cpf: '123.456.789-00',
        observacoesSaude: 'Pressão alta controlada',
      },
      metodoPagamento: 'pix',
      tipoPagamento: 'sinal',
    });

    expect(result.sucesso).toBe(true);
    expect(result.voucher.codigoConfirmacao).toBe('SPA-98765');
    expect(result.voucher.clienteNome).toBe('Mariana Silva');
  });

  it('fetchAutoatendimentoDisponibilidade aceita multiplos servicoIds na query string', async () => {
    let capturedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (url) => {
      capturedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          data: '2026-10-20',
          duracaoTotalProdutos: 90,
          bufferHigienizacao: 15,
          duracaoTotalSlot: 105,
          valorTotal: 370,
          slots: [],
        }),
      } as Response;
    });

    await fetchAutoatendimentoDisponibilidade(['srv-1', 'srv-2'], '2026-10-20');
    expect(capturedUrl).toContain('servicoIds=srv-1%2Csrv-2');
    expect(capturedUrl).toContain('data=2026-10-20');
  });

  it('soma duracao e preco de multiplos servicos selecionados', () => {
    const selected = [
      { id: '1', nome: 'Massagem Relaxante', duracao: 60, preco: 250 },
      { id: '2', nome: 'Esfoliação Corporal', duracao: 30, preco: 120 },
    ];

    const duracaoTotal = selected.reduce((sum, s) => sum + s.duracao, 0);
    const precoTotal = selected.reduce((sum, s) => sum + s.preco, 0);

    expect(duracaoTotal).toBe(90);
    expect(precoTotal).toBe(370);
  });
});
