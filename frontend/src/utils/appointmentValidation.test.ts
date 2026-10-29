import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAppointmentScheduling } from '../features/appointments/utils/appointmentValidation';
import type { Appointment, Service } from '../types';

vi.mock('../features/appointments/utils/appointmentCore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/appointments/utils/appointmentCore')>();
  return {
    ...actual,
    getLocalTodayString: () => '2026-06-01',
    getBrazilCurrentTimeString: () => '12:00',
  };
});

const services: Service[] = [{ id: '1', nome: 'Sessao padrao', duracao: 60, preco: 0 }];

describe('validateAppointmentScheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita horario antes do comercial', () => {
    const err = validateAppointmentScheduling({
      date: '2026-06-10',
      time: '08:00',
      employeeId: 'e1',
      serviceNames: ['Sessao padrao'],
      appointments: [],
      services,
    });
    expect(err).toMatch(/só podem começar entre/i);
  });

  it('rejeita agendamento no passado (mesmo dia)', () => {
    const err = validateAppointmentScheduling({
      date: '2026-06-01',
      time: '09:00',
      employeeId: 'e1',
      serviceNames: ['Sessao padrao'],
      appointments: [],
      services,
    });
    expect(err).toMatch(/passado/i);
  });

  it('rejeita quando ultrapassa fechamento', () => {
    const err = validateAppointmentScheduling({
      date: '2026-06-10',
      time: '20:30',
      employeeId: 'e1',
      serviceNames: ['Sessao padrao'],
      appointments: [],
      services,
    });
    expect(err).toMatch(/fechamento|fechamento as/i);
  });

  it('rejeita conflito de horario', () => {
    const appointments: Appointment[] = [
      {
        id: 'busy',
        clientName: 'A',
        contact: '',
        services: ['Sessao padrao'],
        date: '2026-06-10',
        time: '14:00',
        guests: 1,
        specialNeeds: [],
        assignedEmployeeId: 'e1',
        status: 'scheduled',
      },
    ];
    const err = validateAppointmentScheduling({
      date: '2026-06-10',
      time: '14:30',
      employeeId: 'e1',
      serviceNames: ['Sessao padrao'],
      appointments,
      services,
    });
    expect(err).toMatch(/Conflito/i);
  });

  it('aceita slot livre futuro dentro do comercial', () => {
    const err = validateAppointmentScheduling({
      date: '2026-06-10',
      time: '15:00',
      employeeId: 'e1',
      serviceNames: ['Sessao padrao'],
      appointments: [],
      services,
    });
    expect(err).toBeNull();
  });
});
