import { codigoReserva } from '@shared/codigoReserva';
import { Appointment, Service } from '../../../types';
import { normalizarTexto } from '@shared/validadores';
import { duracaoTotal, horarioParaMinutos } from '@shared/agenda';

type ServiceLike = Pick<Service, 'nome'> & Partial<Pick<Service, 'id' | 'duracao' | 'preco' | 'tempoHigienizacaoMin'>>;

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

const getBrazilDateTimeParts = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${map.hour}:${map.minute}`;
  const hours = Number(map.hour || '0');
  const minutes = Number(map.minute || '0');

  return { date, time, hours, minutes };
};

export const getLocalTodayString = () => {
  return getBrazilDateTimeParts().date;
};

export const getBrazilCurrentTimeString = () => getBrazilDateTimeParts().time;

export const getBrazilCurrentMinuteOfDay = () => {
  const { hours, minutes } = getBrazilDateTimeParts();
  return hours * 60 + minutes;
};

// Data AAAA-MM-DD deslocada em dias (aritmética em UTC ao meio-dia: imune a horário de verão)
export const shiftDateString = (date: string, days: number) => {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

// Base de todas as comparações de texto daqui (fonte única em shared/validadores)
export const normalizeKey = normalizarTexto;

// Mesma regra do backend (shared/agenda.ts): cada serviço soma duração + higienização; sem serviço, a duração padrão
export const getDuration = (serviceNames: string[] = [], services: ServiceLike[] = []) => duracaoTotal(serviceNames.map((rawName) => {
  const key = normalizeKey(String(rawName || ''));
  return services.find((s) => (typeof s.id === 'string' && s.id === rawName) || normalizeKey(s.nome) === key);
}).map((srv) => srv ?? {}));

export const matchesAppointmentSearch = (appointment: Appointment, searchTerm: string): boolean => {
  const query = normalizeKey(searchTerm);
  if (!query) return true;

  return [
    appointment.clientName,
    appointment.contact,
    appointment.observation || '',
    ...(appointment.services || []),
    codigoReserva(appointment.id),
  ].some(value => normalizeKey(value || '').includes(query));
};

export const hasOverlap = (targetDate: string, targetTime: string, empId: string, serviceNames: string[] = [], appointments: Appointment[], services: ServiceLike[] = [], ignoreAppId: string | null = null) => {
  const newStart = horarioParaMinutos(targetTime);
  // Horário ilegível nunca vira "sem conflito": na dúvida, bloqueia (o backend também recusaria)
  if (Number.isNaN(newStart)) return true;
  const newEnd = newStart + getDuration(serviceNames, services);

  return appointments.some(a => {
    // Atendimentos concluídos continuam ocupando o horário (o backend também os considera)
    if (a.id === ignoreAppId || a.date !== targetDate || a.assignedEmployeeId !== empId || !a.time) return false;
    if (a.status !== 'scheduled' && a.status !== 'completed') return false;
    const existStart = horarioParaMinutos(a.time);
    const existEnd = existStart + getDuration(a.services, services);
    return newStart < existEnd && newEnd > existStart;
  });
};
