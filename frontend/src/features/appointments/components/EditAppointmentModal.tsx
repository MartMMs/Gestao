import React, { useState } from 'react';
import { Appointment, Employee, Service } from '../../../types';
import { AppointmentScheduleFields } from '../../../components/AppointmentScheduleFields';
import { AppointmentModalShell } from '../../../components/AppointmentModalShell';
import { validateAppointmentScheduling } from '../utils/appointmentValidation';
import { isApiError } from '../../../api';
import { formatPhone } from '../../../utils/formatters';

export interface EditAppointmentModalProps {
  appointment: Appointment;
  employees: Employee[];
  services: Service[];
  appointments: Appointment[];
  onClose: () => void;
  onEditAppointment?: (id: string, appointment: Partial<Appointment>) => Promise<boolean | void> | void;
  setErrorMessage: (msg: string | null) => void;
  setToastMessage: (msg: string | null) => void;
}

export function EditAppointmentModal({ appointment, employees, services, appointments, onClose, onEditAppointment, setErrorMessage, setToastMessage }: EditAppointmentModalProps) {
  const [editingAppointment, setEditingAppointment] = useState<Appointment>({
    ...appointment,
    contact: appointment.contact && /\d/.test(appointment.contact) ? formatPhone(appointment.contact) : appointment.contact,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const isEditingCompleted = editingAppointment.status === 'completed';
  const [estadoInicial] = useState(() => JSON.stringify(editingAppointment));
  const hasUnsavedChanges = JSON.stringify(editingAppointment) !== estadoInicial;

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConflictMessage(null);
    if (!isEditingCompleted) {
      const scheduleValidationError = validateAppointmentScheduling({
        date: editingAppointment.date,
        time: editingAppointment.time,
        employeeId: editingAppointment.assignedEmployeeId,
        serviceNames: editingAppointment.services,
        appointments,
        services,
        ignoreAppointmentId: editingAppointment.id,
        permitirPassado: editingAppointment.date === appointment.date && editingAppointment.time === appointment.time,
      });

      if (scheduleValidationError) {
        setErrorMessage(scheduleValidationError);
        return;
      }
    }
    if (!onEditAppointment || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const success = await onEditAppointment(editingAppointment.id, editingAppointment);
      if (success !== false) { onClose(); setToastMessage('Agendamento atualizado!'); }
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setConflictMessage(error.message || 'Conflito de horário detectado. Ajuste os dados e tente novamente.');
        return;
      }

      if (isApiError(error) && error.status === 404) {
        setToastMessage('Este agendamento foi alterado ou excluído por outra pessoa.');
        onClose();
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o agendamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppointmentModalShell
      title="Editar Agendamento"
      onClose={onClose}
      hasUnsavedChanges={hasUnsavedChanges}
      onSubmit={handleEditSubmit}
      submitLabel="Salvar Alterações"
      isSubmitting={isSubmitting}
      submitDisabled={isSubmitting}
      submittingLabel="Salvando..."
      alertBanner={conflictMessage ? (
        <div className="mb-4 rounded-2xl border border-error/30 bg-error/10 p-3 text-xs text-on-surface">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[16px] text-error mt-0.5">schedule</span>
            <div>
              <p className="font-bold text-error uppercase tracking-[0.12em] text-[10px]">Conflito de agenda</p>
              <p className="text-on-surface-variant mt-1">{conflictMessage}</p>
              <p className="text-on-surface-variant mt-1">Revise horário, colaborador e serviços antes de salvar novamente.</p>
            </div>
          </div>
        </div>
      ) : undefined}
      infoBanner={isEditingCompleted ? (
        <div className="bg-secondary-container/50 text-on-secondary-container p-3 rounded-xl text-xs flex gap-2 items-center mb-4">
          <span className="material-symbols-outlined text-[16px]">info</span>
          <span>Este agendamento ja foi concluido. Apenas os servicos prestados podem ser ajustados.</span>
        </div>
      ) : undefined}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-2">Cliente</label><input required type="text" value={editingAppointment.clientName} onChange={e => setEditingAppointment(p => p && ({...p, clientName: e.target.value}))} disabled={isEditingCompleted} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm ${isEditingCompleted ? 'opacity-50 cursor-not-allowed' : ''}`} /></div>
        <div><label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-2">Telefone</label><input type="text" value={editingAppointment.contact} onChange={e => setEditingAppointment(p => p && ({...p, contact: formatPhone(e.target.value)}))} maxLength={15} placeholder="(00) 00000-0000" disabled={isEditingCompleted} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm ${isEditingCompleted ? 'opacity-50 cursor-not-allowed' : ''}`} /></div>
      </div>
      <AppointmentScheduleFields
        date={editingAppointment.date}
        time={editingAppointment.time}
        employeeId={editingAppointment.assignedEmployeeId}
        selectedServices={editingAppointment.services}
        details={editingAppointment.observation || ''}
        employees={employees}
        services={services}
        onDateChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, date: value }));
        }}
        onTimeChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, time: value }));
        }}
        onEmployeeChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, assignedEmployeeId: value }));
        }}
        onToggleService={(serviceName) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({
            ...p,
            services: p.services.includes(serviceName) ? p.services.filter(item => item !== serviceName) : [...p.services, serviceName],
          }));
        }}
        onDetailsChange={(value) => setEditingAppointment(p => p && ({ ...p, observation: value }))}
        disabled={isEditingCompleted}
      />
    </AppointmentModalShell>
  );
}