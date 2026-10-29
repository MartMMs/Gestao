import React, { useMemo, useState } from 'react';
import { shiftDateString } from '../utils/appointmentCore';
import { bloqueioDiaInteiro, horarioParaMinutos } from '@shared/agenda';
import { motion } from 'motion/react';
import { Appointment, Bloqueio, Employee } from '../../../types';
import { SCHEDULE_CONFIG } from '../../../config/scheduleConfig';
import { isTeamMember } from '../../../utils/formatters';

export interface BlockModalProps {
  receptionDate: string;
  initialTime: string;
  initialEmpId: string;
  employees: Employee[];
  appointments?: Appointment[];
  onClose: () => void;
  onAddBloqueio?: (b: Omit<Bloqueio, 'id'> & { datas?: string[] }) => Promise<unknown>;
  onReassignAppointment?: (appointmentId: string, newEmployeeId: string) => Promise<unknown> | void;
  setErrorMessage: (msg: string | null) => void;
  setToastMessage: (msg: string | null) => void;
}

const START_TIME = `${String(SCHEDULE_CONFIG.START_HOUR).padStart(2, '0')}:00`;
const END_TIME = `${String(SCHEDULE_CONFIG.END_HOUR).padStart(2, '0')}:00`;

const toMinutes = horarioParaMinutos;
const isFullDayBlock = (b: Bloqueio) => bloqueioDiaInteiro(b);

export function BlockModal({ receptionDate, initialTime, initialEmpId, employees, appointments = [], onClose, onAddBloqueio, onReassignAppointment, setErrorMessage, setToastMessage }: BlockModalProps) {
  const [blockDate, setBlockDate] = useState(receptionDate);
  const [bookTime, setBookTime] = useState(initialTime);
  const [blockEndTime, setBlockEndTime] = useState('');
  const [bookEmp, setBookEmp] = useState(initialEmpId);
  const [blockReason, setBlockReason] = useState('');
  const [isFolga, setIsFolga] = useState(false);
  const [reassignToId, setReassignToId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [blockPreset, setBlockPreset] = useState<'custom' | 'folga' | 'ferias15' | 'ferias30'>('custom');

  const dayOfWeek = useMemo(() => new Date(`${blockDate}T12:00:00`).getDay(), [blockDate]);

  const pendingAppointments = useMemo(() => {
    return appointments.filter((a) => a.assignedEmployeeId === bookEmp && a.date === blockDate && a.status === 'scheduled');
  }, [appointments, bookEmp, blockDate]);

  const suggestedEmployees = useMemo(() => {
    const candidates = employees.filter((emp) => {
      if (emp.id === bookEmp || !isTeamMember(emp)) return false;
      if (emp.diasTrabalho && !emp.diasTrabalho.split(',').includes(String(dayOfWeek))) return false;
      return true;
    });

    return candidates.sort((a, b) => {
      const aOnFolga = (a.bloqueios || []).some((b) => b.data === blockDate && isFullDayBlock(b));
      const bOnFolga = (b.bloqueios || []).some((b) => b.data === blockDate && isFullDayBlock(b));
      if (aOnFolga !== bOnFolga) return aOnFolga ? 1 : -1;

      const aLoad = appointments.filter((app) => app.assignedEmployeeId === a.id && app.date === blockDate && app.status === 'scheduled').length;
      const bLoad = appointments.filter((app) => app.assignedEmployeeId === b.id && app.date === blockDate && app.status === 'scheduled').length;
      return aLoad - bLoad;
    });
  }, [appointments, blockDate, bookEmp, dayOfWeek, employees]);

  const effectiveStart = isFolga ? START_TIME : bookTime;
  const effectiveEnd = isFolga ? END_TIME : blockEndTime;
  const effectiveReason = isFolga ? 'Folga' : blockReason;

  const getPresetDays = () => {
    if (blockPreset === 'ferias15') return 15;
    if (blockPreset === 'ferias30') return 30;
    return 1;
  };

  const buildBlockDateList = () => {
    const totalDays = getPresetDays();
    // Aritmética de datas só com strings AAAA-MM-DD (shiftDateString): não depende do fuso do navegador
    return Array.from({ length: totalDays }, (_, index) => shiftDateString(blockDate, index));
  };

  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddBloqueio) return;

    if (!effectiveStart || !effectiveEnd) {
      setErrorMessage('Defina início e fim do bloqueio.');
      return;
    }

    if (toMinutes(effectiveEnd) <= toMinutes(effectiveStart)) {
      setErrorMessage('Horário final deve ser maior que o horário inicial.');
      return;
    }

    if (blockPreset === 'custom' && !effectiveReason.trim()) {
      setErrorMessage('Informe o motivo do bloqueio.');
      return;
    }

    if (isFolga && pendingAppointments.length > 0 && onReassignAppointment && !reassignToId) {
      setErrorMessage('Selecione um profissional para transferir os agendamentos pendentes.');
      return;
    }

    if (isSaving) return;
    setIsSaving(true);
    let transferidos = 0;
    try {
      // Transfere os atendimentos antes de bloquear. Se uma transferência falhar, o bloqueio não é criado
      // (as já feitas continuam válidas) e o usuário é avisado de quantas foram feitas.
      if (isFolga && pendingAppointments.length > 0 && onReassignAppointment && reassignToId) {
        for (const app of pendingAppointments) {
          await onReassignAppointment(app.id, reassignToId);
          transferidos += 1;
        }
      }

      // Todos os dias (férias/folgas) vão numa única requisição: gravados todos ou nenhum
      const datas = buildBlockDateList();
      const success = await onAddBloqueio({
        data: datas[0],
        datas,
        horaInicio: effectiveStart,
        horaFim: effectiveEnd,
        motivo: blockPreset === 'ferias15'
          ? 'Férias 15 dias'
          : blockPreset === 'ferias30'
            ? 'Férias 30 dias'
            : blockPreset === 'folga'
              ? 'Folga'
              : effectiveReason,
        colaboradorId: bookEmp,
      });
      if (success === false) throw new Error('Erro ao registrar bloqueio.');

      onClose();
      setToastMessage(
        blockPreset === 'ferias15'
          ? 'Férias de 15 dias registradas!'
          : blockPreset === 'ferias30'
            ? 'Férias de 30 dias registradas!'
            : isFolga && pendingAppointments.length > 0 && reassignToId
              ? 'Folga registrada e agendamentos transferidos!'
              : 'Bloqueio registrado!'
      );
    } catch (error) {
      const motivoErro = error instanceof Error && error.message ? error.message : 'Erro ao registrar bloqueio.';
      setErrorMessage(transferidos > 0
        ? `${motivoErro} ${transferidos} de ${pendingAppointments.length} agendamento(s) já foram transferidos; o bloqueio ainda não foi criado. Resolva o restante e tente de novo.`
        : motivoErro);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-sm w-full border border-outline-variant/20">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-headline text-error">Bloquear Agenda</h2>
          <button onClick={onClose} disabled={isSaving} aria-label="Fechar" className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant disabled:opacity-40"><span className="material-symbols-outlined">close</span></button>
        </div>
        <form onSubmit={handleBlockSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">
              {blockPreset === 'custom' || blockPreset === 'folga' ? 'Data do Bloqueio' : 'Data de Início'}
            </label>
            <input required type="date" value={blockDate} onChange={e => setBlockDate(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface font-bold focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Tipo de Bloqueio</label>
            <select
              value={blockPreset}
              onChange={(e) => {
                const nextPreset = e.target.value as typeof blockPreset;
                setBlockPreset(nextPreset);
                setIsFolga(nextPreset !== 'custom');
                if (nextPreset === 'folga') setBlockReason('Folga');
              }}
              className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface font-bold focus:ring-1 focus:ring-primary"
            >
              <option value="custom">Personalizado</option>
              <option value="folga">Folga</option>
              <option value="ferias15">Férias 15 dias</option>
              <option value="ferias30">Férias 30 dias</option>
            </select>
          </div>
          {(blockPreset === 'ferias15' || blockPreset === 'ferias30') && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
              <p className="text-xs font-bold text-primary">
                {blockPreset === 'ferias15' ? (
                  <>
                    📅 <span className="font-bold">{blockDate}</span> até{' '}
                    <span className="font-bold">
                      {shiftDateString(blockDate, 14)}
                    </span>{' '}
                    (15 dias)
                  </>
                ) : (
                  <>
                    📅 <span className="font-bold">{blockDate}</span> até{' '}
                    <span className="font-bold">
                      {shiftDateString(blockDate, 29)}
                    </span>{' '}
                    (30 dias)
                  </>
                )}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4"><div><label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Início</label><input required type="time" min={START_TIME} max={END_TIME} value={effectiveStart} onChange={e => setBookTime(e.target.value)} disabled={isFolga || blockPreset !== 'custom'} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${(isFolga || blockPreset !== 'custom') ? 'opacity-50 cursor-not-allowed' : ''}`} /></div><div><label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Fim</label><input required type="time" min={bookTime || START_TIME} max={END_TIME} value={effectiveEnd} onChange={e => setBlockEndTime(e.target.value)} disabled={isFolga || blockPreset !== 'custom'} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${(isFolga || blockPreset !== 'custom') ? 'opacity-50 cursor-not-allowed' : ''}`} /></div></div>
          <div><label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Profissional</label><select required value={bookEmp} onChange={e => setBookEmp(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm">{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
          <div><label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Motivo</label><input required type="text" value={effectiveReason} onChange={e => setBlockReason(e.target.value)} disabled={isFolga || blockPreset !== 'custom'} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${(isFolga || blockPreset !== 'custom') ? 'opacity-50 cursor-not-allowed' : ''}`} placeholder="Ex: Pausa, Almoço..." /></div>

          {isFolga && pendingAppointments.length > 0 && (
            <div className="rounded-xl border border-error/30 bg-error/10 p-3 space-y-2">
              <p className="text-xs font-bold text-error">Existem {pendingAppointments.length} agendamentos pendentes para este dia.</p>
              <div className="max-h-36 overflow-y-auto pr-1 custom-scrollbar space-y-1.5">
                {pendingAppointments
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((app) => (
                    <div key={app.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-on-surface truncate">{app.clientName}</p>
                        <span className="text-[10px] font-bold text-primary">{app.time}</span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant truncate mt-0.5">{app.services.join(', ') || 'Serviço não informado'}</p>
                    </div>
                  ))}
              </div>
              {onReassignAppointment ? (
                <>
                  <p className="text-[11px] text-on-surface-variant">Deseja transferir agora? Sugestão: profissionais com menor carga no dia.</p>
                  <select value={reassignToId} onChange={(e) => setReassignToId(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-2.5 text-sm">
                    <option value="">Selecione para transferir...</option>
                    {suggestedEmployees.map((emp) => {
                      const load = appointments.filter((app) => app.assignedEmployeeId === emp.id && app.date === blockDate && app.status === 'scheduled').length;
                      const onFolga = (emp.bloqueios || []).some((b) => b.data === blockDate && isFullDayBlock(b));
                      return <option key={emp.id} value={emp.id}>{emp.name}{onFolga ? ' - Folga' : ''} ({load} no dia)</option>;
                    })}
                  </select>
                </>
              ) : (
                <p className="text-[11px] text-on-surface-variant">Abra o painel da supervisão para transferir os agendamentos pendentes.</p>
              )}
            </div>
          )}
          <button type="submit" disabled={isSaving} className="w-full mt-4 bg-error text-onError py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-error/90 transition-all text-white disabled:opacity-60 disabled:cursor-not-allowed">{isSaving ? 'Salvando...' : 'Salvar Bloqueio'}</button>
        </form>
      </motion.div>
    </div>
  );
}