import { describe, it, expect } from 'vitest';
import { estaDeFolga, statusDoDia } from './statusDoDia';
import type { Bloqueio } from '../../../types';

const DATA = '2026-12-10';
const bloqueio = (horaInicio: string, horaFim: string, motivo = 'Médico'): Bloqueio => ({ id: 'b', data: DATA, horaInicio, horaFim, motivo, colaboradorId: 'c' });
const filtro = (...args: Parameters<typeof statusDoDia>) => estaDeFolga(statusDoDia(...args));

describe('filtro "Somente de folga"', () => {
  it('entra quem está de folga, FDS ou férias pela escala', () => {
    expect(filtro({ data: DATA, tipo: 'folga' }, undefined, [])).toBe(true);
    expect(filtro({ data: DATA, tipo: 'fds' }, undefined, [])).toBe(true);
    expect(statusDoDia({ data: DATA, tipo: 'folga', descricao: 'Férias 30 dias' }, undefined, [])?.label).toBe('Férias');
  });

  it('entra quem tem folga, FDS ou férias no ajuste do dia', () => {
    expect(filtro(undefined, { tipo: 'folga' }, [])).toBe(true);
    expect(filtro(undefined, { tipo: 'fds' }, [])).toBe(true);
    expect(filtro(undefined, { tipo: 'folga', descricao: 'ferias' }, [])).toBe(true);
  });

  it('entra quem tem bloqueio do dia inteiro', () => {
    expect(filtro(undefined, undefined, [bloqueio('09:00', '21:00', 'Folga')])).toBe(true);
    expect(filtro(undefined, undefined, [bloqueio('08:00', '22:00', 'Férias 15 dias')])).toBe(true);
  });

  it('fica de fora quem tem só bloqueio parcial', () => {
    const status = statusDoDia(undefined, undefined, [bloqueio('10:00', '12:00'), bloqueio('15:00', '16:00', 'Curso')]);
    expect(status).toEqual({ label: 'Bloqueio', reason: 'Médico | Curso', isAllDayUnavailable: false });
    expect(estaDeFolga(status)).toBe(false);
  });

  it('fica de fora quem trabalha normalmente', () => {
    expect(filtro({ data: DATA, tipo: 'trabalho' }, undefined, [])).toBe(false);
    expect(filtro(undefined, undefined, [])).toBe(false);
  });
});
