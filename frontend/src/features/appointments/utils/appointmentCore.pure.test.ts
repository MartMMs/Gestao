import { describe, it, expect } from 'vitest';
import { shiftDateString, normalizeKey } from './appointmentCore';
describe('shiftDateString', () => {
  it('soma/subtrai dias', () => { expect(shiftDateString('2026-10-29', 1)).toBe('2026-10-30'); expect(shiftDateString('2026-10-29', -1)).toBe('2026-10-28'); });
  it('vira mês/ano', () => { expect(shiftDateString('2026-12-31', 1)).toBe('2027-01-01'); expect(shiftDateString('2026-03-01', -1)).toBe('2026-02-28'); });
  it('bissexto', () => { expect(shiftDateString('2028-02-28', 1)).toBe('2028-02-29'); });
  it('DST BR não afeta', () => { expect(shiftDateString('2018-11-03', 1)).toBe('2018-11-04'); });
  it('zero', () => { expect(shiftDateString('2026-01-15', 0)).toBe('2026-01-15'); });
});
describe('normalizeKey', () => {
  it('acentos/caixa/espaços', () => { expect(normalizeKey('  Estética ÔFURO ')).toBe('estetica ofuro'); });
  it('vazio', () => { expect(normalizeKey('')).toBe(''); });
  it('ç', () => { expect(normalizeKey('Ação')).toBe('acao'); });
});
