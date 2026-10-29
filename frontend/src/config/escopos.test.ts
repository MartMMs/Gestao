import { describe, it, expect } from 'vitest';
import { ESCOPOS, ESCOPOS_MUDANCA, ESCOPOS_PUBLICOS, ehEscopoMudanca } from '@shared/escopos';
describe('ehEscopoMudanca', () => {
  it('aceita todos válidos', () => { for (const e of ESCOPOS_MUDANCA) expect(ehEscopoMudanca(e)).toBe(true); });
  it('rejeita inválidos', () => { for (const v of ['', 'Appointments', 'x', null, undefined, 1, {}, ['appointments'], 'appointments ']) expect(ehEscopoMudanca(v)).toBe(false); });
});
describe('ESCOPOS consistência', () => {
  it('todo valor é escopo válido, sem duplicatas, não vazio', () => {
    for (const [k, lista] of Object.entries(ESCOPOS)) {
      expect(lista.length, k).toBeGreaterThan(0);
      expect(new Set(lista).size, k).toBe(lista.length);
      for (const e of lista) expect(ehEscopoMudanca(e), `${k}:${e}`).toBe(true);
    }
  });
  it('todo escopo é usado por algum tipo', () => {
    const usados = new Set(Object.values(ESCOPOS).flat());
    for (const e of ESCOPOS_MUDANCA) expect(usados.has(e), e).toBe(true);
  });
  it('públicos válidos e sem dados internos', () => {
    for (const e of ESCOPOS_PUBLICOS) expect(ehEscopoMudanca(e)).toBe(true);
    expect(ESCOPOS_PUBLICOS).not.toContain('clients');
    expect(ESCOPOS_PUBLICOS).not.toContain('turno-swaps');
  });
  it('sem duplicatas em ESCOPOS_MUDANCA', () => { expect(new Set(ESCOPOS_MUDANCA).size).toBe(ESCOPOS_MUDANCA.length); });
});
