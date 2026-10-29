import { Appointment, Service } from '../../../types';
import { getBrazilCurrentTimeString, getDuration, getLocalTodayString, hasOverlap } from './appointmentCore';
import { validarHorarioAgendamento } from '@shared/agenda';

type ServiceLike = Pick<Service, 'nome'> & Partial<Pick<Service, 'id' | 'duracao' | 'preco'>>;

interface ValidateAppointmentInput {
  date: string;
  time: string;
  employeeId: string;
  serviceNames: string[];
  appointments: Appointment[];
  services: ServiceLike[];
  ignoreAppointmentId?: string;
  // Edição sem troca de data/horário: não recusa por já ter passado (ex.: incluir serviço após o início)
  permitirPassado?: boolean;
}

export function validateAppointmentScheduling(input: ValidateAppointmentInput): string | null {
  const {
    date,
    time,
    employeeId,
    serviceNames,
    appointments,
    services,
    ignoreAppointmentId,
    permitirPassado = false,
  } = input;

  // Mesmas regras do backend (horário de funcionamento, múltiplos de 15 min, fechamento, passado)
  const durationMinutes = getDuration(serviceNames, services);
  const todayStr = getLocalTodayString();
  const currentTime = getBrazilCurrentTimeString();
  if (!permitirPassado && (date < todayStr || (date === todayStr && time < currentTime))) {
    return 'Não é permitido agendar no passado. Escolha uma data e horário futuros.';
  }

  const scheduleError = validarHorarioAgendamento(date, time, durationMinutes);
  if (scheduleError) return scheduleError;

  const isOccupied = hasOverlap(
    date,
    time,
    employeeId,
    serviceNames,
    appointments,
    services,
    ignoreAppointmentId || null,
  );

  if (isOccupied) {
    return 'Conflito de horário: o profissional já tem atendimento neste intervalo.';
  }

  return null;
}
