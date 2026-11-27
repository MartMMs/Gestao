import { describe, expect, it } from 'vitest';
import { periodosDeAusencia } from './ausencias';

describe('períodos de ausência do RH', () => {
  it('junta dias seguidos com o mesmo motivo e ignora folga comum e quem não está na lista', () => {
    const f = (colaboradorId: string, data: string, descricao?: string) => ({ colaboradorId, data, tipo: 'folga', descricao });
    const nomes = new Map([['a', 'Ana']]);
    expect(periodosDeAusencia([
      f('a', '2026-12-10', 'Férias'), f('a', '2026-12-11', 'Férias'), f('a', '2026-12-12', 'Férias'),
      f('a', '2026-12-20', 'Atestado médico'), f('a', '2026-12-15'), f('b', '2026-12-10', 'Férias'),
    ], nomes)).toEqual([
      { id: 'a', nome: 'Ana', motivo: 'Atestado médico', inicio: '2026-12-20', fim: '2026-12-20' },
      { id: 'a', nome: 'Ana', motivo: 'Férias', inicio: '2026-12-10', fim: '2026-12-12' },
    ]);
  });
});
