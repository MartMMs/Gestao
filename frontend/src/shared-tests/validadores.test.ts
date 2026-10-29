import { describe, expect, it } from 'vitest';
import { cpfValido, telefoneValido, normalizarTelefone, variantesTelefone, variantesCpf, valorMascarado, normalizarNome } from '@shared/validadores';
describe('cpfValido', () => {
  it('aceita CPFs válidos com e sem máscara e numérico', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido(52998224725)).toBe(true);
    expect(cpfValido('111.444.777-35')).toBe(true);
  });
  it('rejeita DV errado, repetidos, tamanho, letras, null', () => {
    for (const c of ['529.982.247-24', '11111111111', '00000000000', '5299822472', '529982247250', '529a982247-25', '', null, undefined, {}, ' ']) expect(cpfValido(c as any)).toBe(false);
  });
});
describe('telefoneValido', () => {
  it('aceita celular, fixo, com DDI e máscara', () => {
    for (const t of ['(11) 98765-4321', '11987654321', '+55 11 98765-4321', '5511987654321', '1132345678', '551132345678', '(55) 98765-4321']) expect([t, telefoneValido(t)]).toEqual([t, true]);
  });
  it('rejeita DDD com zero, celular sem 9, fixo começando com 6-9, curto/longo', () => {
    for (const t of ['01987654321', '10987654321', '11887654321', '1192345678', '1162345678', '119876543', '119876543210', '', null]) expect([t, telefoneValido(t as any)]).toEqual([t, false]);
  });
  it('rejeita DDDs inexistentes (ex.: 20, 23, 25, 29, 30, 36, 39, 40, 50, 52, 56, 57, 58, 59, 60, 70, 72, 76, 78, 80, 90)', () => {
    for (const ddd of ['23', '25', '29', '36', '39', '52', '56', '57', '58', '59', '72', '76', '78']) expect([ddd, telefoneValido(`${ddd}987654321`)]).toEqual([ddd, false]);
  });
  it('normaliza DDI e gera variantes', () => {
    expect(normalizarTelefone('+55 (11) 98765-4321')).toBe('11987654321');
    expect(variantesTelefone('11987654321')).toEqual(['11987654321', '(11) 98765-4321', '5511987654321']);
    expect(variantesTelefone('1132345678')).toContain('(11) 3234-5678');
    expect(variantesTelefone('')).toEqual([]);
    expect(variantesCpf('52998224725')).toEqual(['52998224725', '529.982.247-25']);
    expect(valorMascarado('(11) *****-**21')).toBe(true);
    expect(normalizarNome('  JOÃO   da  Silva ')).toBe('joao da silva');
  });
});
