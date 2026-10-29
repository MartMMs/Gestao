import { describe, expect, it } from 'vitest';
import { hasOverlap, getDuration, shiftDateString } from './appointmentCore';
import { duracaoTotal } from '@shared/agenda';
const svcs = [{ id: 's1', nome: 'Massagem Relaxante', duracao: 60, tempoHigienizacaoMin: 15 }, { id: 's2', nome: 'Ofurô', duracao: 30 }] as any;
const ap = (o: any) => ({ id: 'a', date: '2027-01-04', time: '10:00', assignedEmployeeId: 'e1', status: 'scheduled', services: ['Massagem Relaxante'], ...o });
describe('getDuration', () => {
  it('soma duração + higienização, por nome normalizado ou id; desconhecido = 60', () => {
    expect(getDuration(['massagem relaxante'], svcs)).toBe(75);
    expect(getDuration(['s2', 'OFURO'], svcs)).toBe(60);
    expect(getDuration(['xyz'], svcs)).toBe(60);
  });
  it('lista vazia deve bater com o backend (duracaoTotal([]) = 60)', () => {
    expect(getDuration([], svcs)).toBe(duracaoTotal([]));
  });
});
describe('hasOverlap', () => {
  const apps = [ap({})]; // 10:00-11:15
  it('detecta sobreposição e respeita bordas (higienização incluída)', () => {
    expect(hasOverlap('2027-01-04', '11:00', 'e1', ['Ofurô'], apps, svcs)).toBe(true);
    expect(hasOverlap('2027-01-04', '11:15', 'e1', ['Ofurô'], apps, svcs)).toBe(false);
    expect(hasOverlap('2027-01-04', '09:30', 'e1', ['Ofurô'], apps, svcs)).toBe(false);
    expect(hasOverlap('2027-01-04', '09:31', 'e1', ['Ofurô'], apps, svcs)).toBe(true);
  });
  it('ignora outro profissional, outra data, cancelado e o próprio id; concluído ocupa', () => {
    expect(hasOverlap('2027-01-04', '10:00', 'e2', ['Ofurô'], apps, svcs)).toBe(false);
    expect(hasOverlap('2027-01-05', '10:00', 'e1', ['Ofurô'], apps, svcs)).toBe(false);
    expect(hasOverlap('2027-01-04', '10:00', 'e1', ['Ofurô'], [ap({ status: 'cancelled' })], svcs)).toBe(false);
    expect(hasOverlap('2027-01-04', '10:00', 'e1', ['Ofurô'], apps, svcs, 'a')).toBe(false);
    expect(hasOverlap('2027-01-04', '10:00', 'e1', ['Ofurô'], [ap({ status: 'completed' })], svcs)).toBe(true);
  });
  it('agendamento sem serviços dentro de outro deve conflitar (backend usa 60 min)', () => {
    expect(hasOverlap('2027-01-04', '10:00', 'e1', [], apps, svcs)).toBe(true);
  });
  it('horário inválido não pode ser tratado como "sem conflito"', () => {
    expect(hasOverlap('2027-01-04', 'abc', 'e1', ['Ofurô'], apps, svcs)).toBe(true);
  });
  it('shiftDateString cruza mês/ano', () => {
    expect(shiftDateString('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDateString('2028-03-01', -1)).toBe('2028-02-29');
  });
});
