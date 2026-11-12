import { describe, it, expect } from 'vitest';
import { semanasComFolgaDemais, type DiaEscala } from '@shared/escala';

// Semana de 2026-11-16 (segunda) a 2026-11-22 (domingo)
const semana = (folgas: Record<string, Partial<DiaEscala>>): DiaEscala[] => Array.from({ length: 7 }, (_, i) => {
  const data = `2026-11-${16 + i}`;
  return { data, tipo: 'trabalho', ...folgas[data] } as DiaEscala;
});

describe('folgas por semana', () => {
  it('6x1: a segunda folga na semana passa do limite', () => {
    expect(semanasComFolgaDemais('6x1', semana({ '2026-11-22': { tipo: 'fds' } }))).toEqual([]);
    expect(semanasComFolgaDemais('6x1', semana({ '2026-11-18': { tipo: 'folga' }, '2026-11-22': { tipo: 'fds' } })))
      .toEqual([{ semana: '2026-11-16', folgas: ['2026-11-18', '2026-11-22'] }]);
  });
  it('6x1: feriado e férias não contam como descanso semanal', () => {
    expect(semanasComFolgaDemais('6x1', semana({
      '2026-11-20': { tipo: 'folga', feriadoNome: 'Consciência Negra' },
      '2026-11-18': { tipo: 'folga', descricao: 'Férias' },
      '2026-11-22': { tipo: 'fds' },
    }))).toEqual([]);
  });
  it('5x2: duas folgas em quaisquer dias da semana', () => {
    expect(semanasComFolgaDemais('5x2', semana({ '2026-11-17': { tipo: 'folga' }, '2026-11-20': { tipo: 'folga' } }))).toEqual([]);
  });
});
