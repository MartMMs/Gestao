import { describe, it, expect } from 'vitest';
import { ESCOPOS, ESCOPOS_MUDANCA, ESCOPOS_PUBLICOS, DEPENDENCIAS_ESCOPO, ehEscopoMudanca } from '@shared/escopos';
import { JANELA_AGENDA_DIAS } from '@shared/agendaJanela';

describe('shared/escopos', () => {
  it('grupos só-internos (escala, clientes) não contêm escopo público', () => {
    for (const g of ['escala', 'clientes'] as const)
      for (const e of ESCOPOS[g]) expect(ESCOPOS_PUBLICOS).not.toContain(e);
  });
  it('todo escopo de todo grupo é válido', () => {
    for (const lista of Object.values(ESCOPOS)) for (const e of lista) expect(ehEscopoMudanca(e)).toBe(true);
  });
  it('ESCOPOS_PUBLICOS só tem escopos válidos e exatamente appointments+services', () => {
    expect([...ESCOPOS_PUBLICOS].sort()).toEqual(['appointments', 'services']);
    ESCOPOS_PUBLICOS.forEach(e => expect(ehEscopoMudanca(e)).toBe(true));
  });
  it('DEPENDENCIAS_ESCOPO só referencia escopos válidos e sem auto-dependência', () => {
    for (const [k, deps] of Object.entries(DEPENDENCIAS_ESCOPO)) {
      expect(ehEscopoMudanca(k)).toBe(true);
      for (const d of deps!) { expect(ehEscopoMudanca(d)).toBe(true); expect(d).not.toBe(k); }
    }
  });
  it('ESCOPOS_MUDANCA sem duplicatas; ehEscopoMudanca rejeita lixo', () => {
    expect(new Set(ESCOPOS_MUDANCA).size).toBe(ESCOPOS_MUDANCA.length);
    for (const v of ['', 'APPOINTMENTS', null, undefined, 1, {}, '__proto__', 'toString']) expect(ehEscopoMudanca(v)).toBe(false);
  });
  it('JANELA_AGENDA_DIAS é inteiro positivo', () => {
    expect(Number.isInteger(JANELA_AGENDA_DIAS) && JANELA_AGENDA_DIAS > 0).toBe(true);
  });
});
