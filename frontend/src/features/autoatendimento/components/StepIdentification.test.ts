import { describe, expect, it } from 'vitest';
import { dataHumana } from './StepIdentification';

describe('data da pré-reserva no totem', () => {
  it('mostra dia da semana e DD/MM/AAAA em vez de ISO', () => {
    expect(dataHumana('2026-11-21')).toBe('sáb, 21/11/2026');
    expect(dataHumana('2026-01-04')).toBe('dom, 04/01/2026');
  });
});
