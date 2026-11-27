import { describe, it, expect } from 'vitest';
import { folgaAcimaDoLimite, semanasComFolgaDemais, type DiaEscala } from '@shared/escala';

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
      '2026-11-19': { tipo: 'folga', descricao: 'Férias – 2ª parcela' },
      '2026-11-22': { tipo: 'fds' },
    }))).toEqual([]);
  });
  it('5x2: duas folgas em quaisquer dias da semana', () => {
    expect(semanasComFolgaDemais('5x2', semana({ '2026-11-17': { tipo: 'folga' }, '2026-11-20': { tipo: 'folga' } }))).toEqual([]);
  });
  it('antes e depois: recusa só quando a mudança acrescenta folga acima do limite', () => {
    const domingo = { '2026-11-22': { tipo: 'fds' as const } };
    // Semana normal: uma folga nova passa do limite
    expect(folgaAcimaDoLimite('6x1', semana(domingo), semana({ ...domingo, '2026-11-18': { tipo: 'folga' } }))?.folgas).toEqual(['2026-11-18', '2026-11-22']);
    // Semana que já tinha 3: mudar um turno ou tirar uma folga é aceito; acrescentar outra não
    const tres = { ...domingo, '2026-11-16': { tipo: 'folga' as const }, '2026-11-17': { tipo: 'folga' as const } };
    expect(folgaAcimaDoLimite('6x1', semana(tres), semana({ ...tres, '2026-11-19': { turno: '10:00-19:00' } }))).toBeNull();
    expect(folgaAcimaDoLimite('6x1', semana(tres), semana({ ...domingo, '2026-11-16': { tipo: 'folga' } }))).toBeNull();
    expect(folgaAcimaDoLimite('6x1', semana(tres), semana({ ...tres, '2026-11-20': { tipo: 'folga' } }))).not.toBeNull();
    expect(folgaAcimaDoLimite('5x2', semana({}), semana({ '2026-11-17': { tipo: 'folga' }, '2026-11-20': { tipo: 'folga' } }))).toBeNull();
  });
});
