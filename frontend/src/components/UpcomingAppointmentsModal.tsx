import React, { useMemo, useState } from 'react';
import { normalizarTexto } from '@shared/validadores';
import { horarioParaMinutos } from '@shared/agenda';
import { motion } from 'motion/react';
import { Appointment, Employee, Service } from '../types';
import { getBrazilCurrentMinuteOfDay, getLocalTodayString } from '../features/appointments/utils/appointmentCore';
import { isTeamMember } from '../utils/formatters';

interface UpcomingAppointmentsModalProps {
  open: boolean;
  appointments: Appointment[];
  employees: Employee[];
  services: Service[];
  onClose: () => void;
}

type DateFilter = 'today' | '7days' | '30days' | 'all';

const normalizeText = (value?: string) => normalizarTexto(value);

export function UpcomingAppointmentsModal({ open, appointments, employees, services, onClose }: UpcomingAppointmentsModalProps) {
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const todayStr = getLocalTodayString();

  const filteredAppointments = useMemo(() => {
    const search = normalizeText(searchTerm);
    const today = new Date(`${todayStr}T12:00:00`);
    const currentMinuteOfDay = getBrazilCurrentMinuteOfDay();
    const sevenDaysAhead = new Date(today);
    sevenDaysAhead.setDate(today.getDate() + 7);
    const thirtyDaysAhead = new Date(today);
    thirtyDaysAhead.setDate(today.getDate() + 30);

    return appointments
      .filter((appointment) => appointment.status === 'scheduled')
      .filter((appointment) => {
        if (employeeFilter !== 'all' && appointment.assignedEmployeeId !== employeeFilter) return false;

        const appointmentDate = new Date(`${appointment.date}T12:00:00`);
        if (appointmentDate < today) return false;
        if (appointment.date === todayStr) {
          const inicio = horarioParaMinutos(appointment.time);
          if (Number.isNaN(inicio) || inicio < currentMinuteOfDay) return false;
        }
        if (dateFilter === 'today' && appointment.date !== todayStr) return false;
        if (dateFilter === '7days' && appointmentDate > sevenDaysAhead) return false;
        if (dateFilter === '30days' && appointmentDate > thirtyDaysAhead) return false;

        if (!search) return true;

        const employeeName = normalizeText(employees.find((employee) => employee.id === appointment.assignedEmployeeId)?.name);
        const clientName = normalizeText(appointment.clientName);
        const serviceNames = normalizeText(appointment.services.join(' '));
        return clientName.includes(search) || employeeName.includes(search) || serviceNames.includes(search);
      })
      .sort((a, b) => new Date(`${a.date}T${a.time}:00`).getTime() - new Date(`${b.date}T${b.time}:00`).getTime());
  }, [appointments, dateFilter, employeeFilter, employees, searchTerm, todayStr]);

  const summary = useMemo(() => {
    const currentMinuteOfDay = getBrazilCurrentMinuteOfDay();
    return {
      today: appointments.filter((appointment) => {
        if (appointment.status !== 'scheduled' || appointment.date !== todayStr) return false;
        const inicio = horarioParaMinutos(appointment.time);
        return !Number.isNaN(inicio) && inicio >= currentMinuteOfDay;
      }).length,
      future: appointments.filter((appointment) => appointment.status === 'scheduled' && appointment.date > todayStr).length,
    };
  }, [appointments, todayStr]);

  const formatDateLabel = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day));
  };

  const resolveEmployeeName = (employeeId: string) => employees.find((employee) => employee.id === employeeId)?.name || 'Sem profissional';

  const resolveServicesLabel = (appointment: Appointment) => {
    if (appointment.services.length === 0) return 'Sem serviço informado';
    return appointment.services
      .map((serviceName) => services.find((service) => service.nome === serviceName)?.nome || serviceName)
      .join(', ');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-80 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-3xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant/20 bg-surface-container p-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Agenda rápida</p>
            <h2 className="text-2xl font-headline text-primary mt-1">Próximos atendimentos</h2>
            <p className="text-sm text-on-surface-variant mt-1">Veja quem atende hoje, nos próximos dias e de outros profissionais.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-on-surface-variant hover:bg-surface-container-high">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="grid gap-3 border-b border-outline-variant/20 bg-surface-container-low px-6 py-4 md:grid-cols-4">
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Hoje</p>
            <p className="text-2xl font-headline text-primary">{summary.today}</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Próximos dias</p>
            <p className="text-2xl font-headline text-primary">{summary.future}</p>
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Buscar</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cliente, serviço ou profissional"
              className="w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Profissional</label>
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">Todos os profissionais</option>
              {employees.filter((employee) => isTeamMember(employee)).map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-outline-variant/20 bg-surface-container-low px-6 py-4">
          {([
            { key: 'today', label: 'Hoje' },
            { key: '7days', label: '7 dias' },
            { key: '30days', label: '30 dias' },
            { key: 'all', label: 'Tudo' },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setDateFilter(option.key)}
              className={`rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${dateFilter === option.key ? 'bg-primary text-on-primary shadow-sm' : 'bg-surface-container-lowest text-on-surface-variant hover:text-primary'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto custom-scrollbar p-6">
          {filteredAppointments.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low p-8 text-center">
              <p className="text-sm text-on-surface-variant">Nenhum atendimento encontrado com esse filtro.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAppointments.map((appointment) => (
                <div key={appointment.id} className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 shadow-sm">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-bold text-on-surface">{appointment.clientName}</h3>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">{appointment.time}</span>
                        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{formatDateLabel(appointment.date)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-on-surface-variant">{resolveServicesLabel(appointment)}</p>
                    </div>
                    <div className="flex flex-col md:items-end">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Profissional</p>
                      <p className="text-sm font-bold text-on-surface">{resolveEmployeeName(appointment.assignedEmployeeId)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}