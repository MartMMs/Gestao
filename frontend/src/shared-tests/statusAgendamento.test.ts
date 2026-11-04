import { describe, expect, it } from 'vitest';
import { semBaixaVencido, statusFechado } from '@shared/statusAgendamento';

const inicio = new Date('2026-10-30T13:00:00Z'); // 10:00 em São Paulo
const servicos = [{ duracao: 60, tempoHigienizacaoMin: 15 }]; // ocupa até 11:15
const minutosDepois = (min: number) => new Date(inicio.getTime() + min * 60_000);

describe('falta sem baixa', () => {
  it('agendado cujo fim (com higienização) já passou conta como sem baixa', () => {
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos }, minutosDepois(76))).toBe(true);
    expect(semBaixaVencido({ status: null, inicio, servicos }, minutosDepois(76))).toBe(true); // status antigo nulo = agendado
  });

  it('em andamento (inclusive durante a higienização) ainda não é sem baixa', () => {
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos }, minutosDepois(30))).toBe(false);
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos }, minutosDepois(65))).toBe(false);
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos }, minutosDepois(-10))).toBe(false);
  });

  it('atendimento com baixa nunca é sem baixa', () => {
    for (const status of ['completed', 'no_show', 'cancelled']) {
      expect(statusFechado(status)).toBe(true);
      expect(semBaixaVencido({ status, inicio, servicos }, minutosDepois(600))).toBe(false);
    }
    expect(statusFechado(null)).toBe(false);
  });

  it('sem serviços usa a duração padrão (60 min)', () => {
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos: [] }, minutosDepois(59))).toBe(false);
    expect(semBaixaVencido({ status: 'scheduled', inicio, servicos: [] }, minutosDepois(61))).toBe(true);
  });
});
