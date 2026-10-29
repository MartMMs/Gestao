import React, { useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { isApiError } from '../../../api';

export interface DeleteAppointmentModalProps {
  appointmentId: string;
  onClose: () => void;
  onDeleteAppointment: (id: string) => Promise<boolean | void> | void;
  setToastMessage: (msg: string | null) => void;
  setErrorMessage?: (msg: string | null) => void;
  // 'cancelar' desmarca mantendo histórico (colaborador); 'excluir' apaga de vez (supervisão)
  modo?: 'excluir' | 'cancelar';
}

export function DeleteAppointmentModal({ appointmentId, onClose, onDeleteAppointment, setToastMessage, setErrorMessage, modo = 'excluir' }: DeleteAppointmentModalProps) {
  const cancelar = modo === 'cancelar';
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onDeleteAppointment(appointmentId);
      setToastMessage(cancelar ? 'Agendamento cancelado.' : 'Agendamento excluído.');
      onClose();
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        setToastMessage('Este agendamento já tinha sido excluído por outra pessoa.');
        onClose();
        return;
      }

      setErrorMessage?.(error instanceof Error ? error.message : cancelar ? 'Não foi possível cancelar o agendamento.' : 'Não foi possível excluir o agendamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConfirmDialog
      open={true}
      title={cancelar ? 'Cancelar este agendamento?' : 'Excluir este agendamento?'}
      description={cancelar
        ? 'O horário volta a ficar livre na agenda. O cancelamento fica registrado no histórico.'
        : 'O agendamento será apagado definitivamente da agenda. Esta ação não pode ser desfeita.'}
      confirmLabel={cancelar ? 'Sim, cancelar' : 'Sim, excluir'}
      confirmingLabel={cancelar ? 'Cancelando...' : 'Excluindo...'}
      cancelLabel="Manter agendamento"
      icon="event_busy"
      isSubmitting={isSubmitting}
      onClose={onClose}
      onConfirm={handleConfirm}
    />
  );
}