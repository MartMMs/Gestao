import { describe, expect, it } from 'vitest';
import { calcularPascoa, obterFeriadosNacionais, ehFeriado, obterNomeFeriado, feriadosEntre, proximoFeriado, obterFeriadosMes } from '@shared/feriadosBR';
const iso = (d: Date) => d.toISOString().slice(0, 10);
describe('feriados', () => {
  it('Páscoa conhecida', () => {
    expect(iso(calcularPascoa(2024))).toBe('2024-03-31');
    expect(iso(calcularPascoa(2025))).toBe('2025-04-20');
    expect(iso(calcularPascoa(2026))).toBe('2026-04-05');
    expect(iso(calcularPascoa(2038))).toBe('2038-04-25');
    expect(iso(calcularPascoa(2008))).toBe('2008-03-23');
  });
  it('móveis 2026', () => {
    expect(obterNomeFeriado('2026-02-16')).toBe('Carnaval (segunda-feira)');
    expect(obterNomeFeriado('2026-02-17')).toBe('Carnaval');
    expect(obterNomeFeriado('2026-04-03')).toBe('Sexta-feira Santa');
    expect(obterNomeFeriado('2026-06-04')).toBe('Corpus Christi');
    expect(obterFeriadosNacionais(2026)).toHaveLength(13);
  });
  it('fixos e limites', () => {
    expect(ehFeriado('2026-11-20')).toBe(true);
    expect(ehFeriado('2026-11-21')).toBe(false);
    expect(feriadosEntre('2026-12-25', '2027-01-01').map(f => f.data)).toEqual(['2026-12-25', '2027-01-01']);
    expect(proximoFeriado('2026-12-26')?.data).toBe('2027-01-01');
    expect(obterFeriadosMes(2026, 11)).toEqual({ 2: 'Finados', 15: 'Proclamação da República', 20: 'Dia Nacional de Zumbi e da Consciência Negra' });
  });
  it('Consciência Negra só é feriado nacional a partir de 2024 (Lei 14.759/2023)', () => {
    expect(ehFeriado('2023-11-20')).toBe(false);
  });
  it('cache não deve vazar mutação para o chamador', () => {
    const a = obterFeriadosNacionais(2030); a.length = 0;
    expect(obterFeriadosNacionais(2030).length).toBe(13);
  });
});
