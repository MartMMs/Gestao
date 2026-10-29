import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Appointment } from '../types';
import { getLocalTodayString } from '../features/appointments/utils/appointmentCore';

// Mesmo limite do servidor (escalaRoutes)
const LIMITE_MOTIVO = 500;

export interface TrocaTurnoPayload {
  colaboradorId: string;
  dataOriginal: string;
  dataSolicitada: string;
  motivo: string;
  status: 'pendente';
}

interface SolicitarTrocaProps {
  open: boolean;
  onClose: () => void;
  colaboradorId: string;
  appointments: Appointment[];
  onSubmitTroca?: (payload: TrocaTurnoPayload) => Promise<boolean | void> | boolean | void;
  setErrorMessage: (msg: string | null) => void;
  setToastMessage: (msg: string | null) => void;
}

export function SolicitarTroca({
  open,
  onClose,
  colaboradorId,
  appointments,
  onSubmitTroca,
  setErrorMessage,
  setToastMessage,
}: SolicitarTrocaProps) {
  const [dataOriginal, setDataOriginal] = useState('');
  const [dataSolicitada, setDataSolicitada] = useState('');
  const [motivo, setMotivo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const turnoOriginal = useMemo(
    () => appointments.find((app) => app.date === dataOriginal && app.assignedEmployeeId === colaboradorId),
    [appointments, colaboradorId, dataOriginal],
  );

  if (!open) return null;

  const hoje = getLocalTodayString();

  const resetAndClose = () => {
    setDataOriginal('');
    setDataSolicitada('');
    setMotivo('');
    onClose();
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!dataOriginal || !dataSolicitada || !motivo.trim()) {
      setErrorMessage('Preencha data original, data solicitada e motivo da troca.');
      return;
    }

    if (dataSolicitada === dataOriginal) {
      setErrorMessage('A data solicitada deve ser diferente da data original.');
      return;
    }

    if (dataOriginal < hoje || dataSolicitada < hoje) {
      setErrorMessage('Escolha datas a partir de hoje.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: TrocaTurnoPayload = {
        colaboradorId,
        dataOriginal,
        dataSolicitada,
        motivo: motivo.trim(),
        status: 'pendente',
      };

      if (onSubmitTroca) {
        const result = await onSubmitTroca(payload);
        if (result === false) {
          setErrorMessage('Não foi possível enviar a solicitação de troca.');
          return;
        }
      }

      setToastMessage('Solicitação de troca enviada com sucesso.');
      resetAndClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao enviar a solicitação de troca.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // X ou clique fora: não fecha durante o envio e não descarta o que foi digitado sem perguntar
  const fecharComConfirmacao = () => {
    if (isSubmitting) return;
    const temConteudo = Boolean(dataOriginal || dataSolicitada || motivo.trim());
    if (temConteudo && !window.confirm('Descartar a solicitação de troca que você estava preenchendo?')) return;
    resetAndClose();
  };

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[90] p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) fecharComConfirmacao(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-headline text-primary">Solicitar Troca de Turno</h3>
          <button type="button" onClick={fecharComConfirmacao} disabled={isSubmitting} aria-label="Fechar" className="p-2 rounded-full disabled:opacity-40 hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.15em] mb-2">Data original</label>
            <input type="date" min={hoje} value={dataOriginal} onChange={(event) => setDataOriginal(event.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
          </div>

          {turnoOriginal && (
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Turno encontrado</p>
              <p className="text-sm font-bold text-on-surface mt-1">{turnoOriginal.time} - {turnoOriginal.clientName}</p>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.15em] mb-2">Data solicitada</label>
            <input type="date" min={hoje} value={dataSolicitada} onChange={(event) => setDataSolicitada(event.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-[0.15em] mb-2">Motivo</label>
            <textarea
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              placeholder="Descreva o motivo da troca"
              maxLength={LIMITE_MOTIVO}
              className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm min-h-[96px] resize-none"
            />
            <p className="text-[10px] text-on-surface-variant text-right mt-1">{motivo.length}/{LIMITE_MOTIVO}</p>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim disabled:opacity-60"
          >
            {isSubmitting ? 'Enviando...' : 'Solicitar Troca'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
