import { describe, it, expect } from 'vitest';
import { aplicarAjusteEscala, gerarEscalaComRegras } from '@shared/escala';

// Semana de 2026-11-16 (segunda) a 2026-11-22 (domingo), sem feriado
const semana = (turnoPadrao?: string | null) => gerarEscalaComRegras({ tipo: '6x1', dataInicio: '2026-11-16' }, 7, { turnoPadrao });

describe('turno padrão do cadastro', () => {
  it('vai para os dias de trabalho; a folga continua sem turno', () => {
    const dias = semana('09:00-18:00');
    expect(dias.filter((d) => d.tipo === 'trabalho').every((d) => d.turno === '09:00-18:00' && d.horaInicio === '09:00' && d.horaFim === '18:00')).toBe(true);
    const domingo = dias.find((d) => d.data === '2026-11-22');
    expect(domingo?.tipo).toBe('fds');
    expect(domingo?.turno).toBeUndefined();
  });
  it('sem turno padrão (cadastros antigos) fica como antes: dia de trabalho sem turno', () => {
    expect(semana(null).filter((d) => d.tipo === 'trabalho').every((d) => d.turno === undefined)).toBe(true);
    expect(semana('lixo').some((d) => d.turno)).toBe(false);
    expect(semana('25:00-26:00').some((d) => d.turno)).toBe(false);
  });
  it('o ajuste do dia tem prioridade sobre o turno padrão', () => {
    const quarta = semana('09:00-18:00').find((d) => d.data === '2026-11-18')!;
    expect(aplicarAjusteEscala(quarta, { tipo: 'trabalho', turno: '13:00-22:00' })).toMatchObject({ turno: '13:00-22:00', horaInicio: '13:00', horaFim: '22:00' });
    const folga = aplicarAjusteEscala(quarta, { tipo: 'folga' });
    expect(folga.tipo).toBe('folga');
    expect(folga.turno).toBeUndefined();
  });
});
