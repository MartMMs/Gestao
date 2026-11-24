import { describe, expect, it } from 'vitest';
import { formatarDataBR, formatarDataComDiaSemanaBR, formatarDataHoraBR } from './datasBR';

describe('datas em DD/MM/AAAA', () => {
  it('AAAA-MM-DD não recua um dia por causa do fuso', () => {
    expect(formatarDataBR('2026-11-23')).toBe('23/11/2026');
    expect(formatarDataBR('2026-01-01')).toBe('01/01/2026');
  });
  it('timestamp UTC vira o dia de Brasília', () => {
    expect(formatarDataBR('2026-11-24T02:30:00Z')).toBe('23/11/2026');
    expect(formatarDataHoraBR('2026-11-23T12:00:00Z')).toBe('23/11/2026 09:00');
    expect(formatarDataHoraBR(new Date('2026-11-23T12:00:00Z'), { comAs: true })).toBe('23/11/2026 às 09:00');
  });
  it('dia da semana', () => {
    expect(formatarDataComDiaSemanaBR('2026-11-23')).toBe('seg, 23/11/2026');
  });
  it('entrada vazia ou inválida vira texto vazio', () => {
    for (const v of ['', null, undefined, 'abc', '2026-13-01']) {
      expect(formatarDataBR(v)).toBe('');
      expect(formatarDataHoraBR(v)).toBe('');
      expect(formatarDataComDiaSemanaBR(v)).toBe('');
    }
  });
});
