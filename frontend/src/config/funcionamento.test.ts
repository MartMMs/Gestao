import { describe, expect, it } from 'vitest';
import { FUNCIONAMENTO_PADRAO } from '@shared/agenda';
import { horasDaGrade } from './funcionamento';

describe('horasDaGrade', () => {
  it('vai da abertura ao fechamento arredondado para cima', () => {
    expect(horasDaGrade({ ...FUNCIONAMENTO_PADRAO, abertura: '08:30', fechamento: '18:15' })).toEqual({ horaInicioGrade: 8, horaFimGrade: 19 });
  });
  it('cresce para mostrar atendimento marcado fora do horário', () => {
    // 07:00–08:00 antes da abertura e 21:30–22:30 depois do fechamento
    expect(horasDaGrade(FUNCIONAMENTO_PADRAO, [[420, 480], [1290, 1350]])).toEqual({ horaInicioGrade: 7, horaFimGrade: 23 });
  });
});
