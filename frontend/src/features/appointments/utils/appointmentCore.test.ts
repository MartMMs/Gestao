import { describe, expect, it } from 'vitest';
import { getDuration, hasOverlap } from './appointmentCore';
import type { Appointment, Service } from '../../../types';

const services: Service[] = [
  { id: '1', nome: 'Massagem relaxante', duracao: 60, preco: 100 },
  { id: '2', nome: 'Drenagem', duracao: 30, preco: 80 },
];

const baseAppt = (over: Partial<Appointment>): Appointment => ({
  id: 'a1',
  clientName: 'Cliente',
  contact: '(11) 99999-9999',
  services: ['Massagem relaxante'],
  date: '2026-06-15',
  time: '10:00',
  guests: 1,
  specialNeeds: [],
  assignedEmployeeId: 'emp-1',
  status: 'scheduled',
  ...over,
});

describe('getDuration', () => {
  it('soma duracoes pelos nomes dos servicos', () => {
    expect(getDuration(['Massagem relaxante', 'Drenagem'], services)).toBe(90);
  });

  it('usa 60 min quando servico nao encontrado', () => {
    expect(getDuration(['Inexistente'], services)).toBe(60);
  });
});

describe('hasOverlap', () => {
  it('detecta sobreposicao no mesmo dia e colaborador', () => {
    const appointments: Appointment[] = [
      baseAppt({ id: 'x', time: '10:00', services: ['Massagem relaxante'] }),
    ];
    const overlap = hasOverlap(
      '2026-06-15',
      '10:30',
      'emp-1',
      ['Massagem relaxante'],
      appointments,
      services,
      null,
    );
    expect(overlap).toBe(true);
  });

  it('nao conflita quando horarios nao se tocam', () => {
    const appointments: Appointment[] = [
      baseAppt({ id: 'x', time: '10:00', services: ['Drenagem'] }),
    ];
    const overlap = hasOverlap(
      '2026-06-15',
      '11:00',
      'emp-1',
      ['Drenagem'],
      appointments,
      services,
      null,
    );
    expect(overlap).toBe(false);
  });

  it('ignora agendamento cancelado ou de outro profissional', () => {
    const appointments: Appointment[] = [
      baseAppt({ id: 'x', time: '10:00', status: 'cancelled' }),
      baseAppt({ id: 'y', time: '10:00', assignedEmployeeId: 'outro' }),
    ];
    expect(
      hasOverlap('2026-06-15', '10:00', 'emp-1', ['Massagem relaxante'], appointments, services, null),
    ).toBe(false);
  });

  it('considera agendamento concluido como ocupado (igual ao backend)', () => {
    const appointments: Appointment[] = [baseAppt({ id: 'x', time: '10:00', status: 'completed' })];
    expect(
      hasOverlap('2026-06-15', '10:00', 'emp-1', ['Massagem relaxante'], appointments, services, null),
    ).toBe(true);
  });

  it('respeita ignoreAppointmentId na edicao', () => {
    const appointments: Appointment[] = [baseAppt({ id: 'edit-me', time: '10:00' })];
    expect(
      hasOverlap('2026-06-15', '10:00', 'emp-1', ['Massagem relaxante'], appointments, services, 'edit-me'),
    ).toBe(false);
  });
});
