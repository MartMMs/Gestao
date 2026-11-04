import React, { useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { ehVersaoDesatualizada, isApiError } from '../../../api';
import { CODIGO_FORA_DA_AGENDA } from '@shared/statusAgendamento';

export interface DeleteAppointmentModalProps {
  appointmentId: string;
  // Versão do atendimento na tela quando o diálogo abriu: se alguém o alterar antes da confirmação, o servidor recusa
  version?: string;
  onClose: () => void;
  onDeleteAppointment: (id: string, version?: string) => Promise<boolean | void> | void;
  setToastMessage: (msg: string | null) => void;
  setErrorMessage?: (msg: string | null) => void;
  // 'cancelar' desmarca mantendo histórico (colaborador); 'excluir' apaga de vez (supervisão)
  modo?: 'excluir' | 'cancelar';
}

export function DeleteAppointmentModal({ appointmentId, version, onClose, onDeleteAppointment, setToastMessage, setErrorMessage, modo = 'excluir' }: DeleteAppointmentModalProps) {
  const cancelar = modo === 'cancelar';
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Congelada na abertura: o aviso em tempo real atualiza a agenda por baixo, e a versão nova apagaria a edição alheia
  const [versaoAoAbrir] = useState(version);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      await onDeleteAppointment(appointmentId, versaoAoAbrir);
      setToastMessage(cancelar ? 'Agendamento cancelado.' : 'Agendamento excluído.');
      onClose();
    } catch (error) {
      // Mudou desde que o diálogo abriu: fechar (a agenda recarrega) em vez de repetir o 409 com a versão velha
      if (ehVersaoDesatualizada(error)) {
        setErrorMessage?.(error instanceof Error ? error.message : 'Este agendamento mudou. Confira e tente de novo.');
        onClose();
        return;
      }
      // Passado para outro profissional enquanto o diálogo estava aberto: fechar (repetir daria o mesmo 403)
      if (isApiError(error) && error.code === CODIGO_FORA_DA_AGENDA) {
        setErrorMessage?.('Este agendamento saiu da sua agenda (passado para outro profissional). Nada foi alterado.');
        onClose();
        return;
      }
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