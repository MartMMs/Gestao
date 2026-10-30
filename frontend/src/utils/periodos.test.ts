import { describe, expect, it } from 'vitest';
import { periodoRapido } from './periodos';

describe('periodoRapido', () => {
  it('mês atual vai do dia 1 até hoje', () => {
    expect(periodoRapido('mes', '2026-10-30')).toEqual({ de: '2026-10-01', ate: '2026-10-30' });
    expect(periodoRapido('mes', '2026-11-01')).toEqual({ de: '2026-11-01', ate: '2026-11-01' });
  });

  it('mês passado fecha no último dia, inclusive na virada de ano e em fevereiro', () => {
    expect(periodoRapido('mesPassado', '2026-01-15')).toEqual({ de: '2025-12-01', ate: '2025-12-31' });
    expect(periodoRapido('mesPassado', '2028-03-31')).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
  });

  it('30 dias e 12 meses contam hoje e cabem no limite de 366 dias do relatório', () => {
    expect(periodoRapido('30dias', '2026-03-01')).toEqual({ de: '2026-01-31', ate: '2026-03-01' });
    const ano = periodoRapido('12meses', '2026-10-30');
    expect(ano).toEqual({ de: '2025-10-30', ate: '2026-10-30' });
    expect((Date.parse(ano.ate) - Date.parse(ano.de)) / 86_400_000 + 1).toBeLessThanOrEqual(366);
  });
});
