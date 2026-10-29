import React, { createContext, useContext, useMemo } from 'react';
import { Appointment, Employee, Service } from '../types';
import { getDuration } from '../features/appointments/utils/appointmentCore';

export interface ScheduleGridContext {
  receptionDate: string;
  services: Service[];
  startHour: number;
  endHour: number;
  minuteHeight: number;
  hourHeight: number;
  isTodayView: boolean;
  currentMinute: Date;
  todayStr: string;
  employeeUnavailableReasons?: Record<string, string>;
}

export interface ScheduleGridActions {
  onGridClick: (e: React.MouseEvent<HTMLDivElement>, empId: string) => void;
  onDeleteBloqueio?: (id: string) => Promise<boolean | void> | void;
  onReassignAppointment?: (appointmentId: string, newEmployeeId: string) => Promise<boolean | void> | void;
  onCompleteAppointment: (id: string) => void;
  onEditAppointmentClick: (appointment: Appointment) => void;
  onDeleteAppointmentClick: (id: string) => void;
  setToastMessage: (msg: string | null) => void;
  setErrorMessage: (msg: string | null) => void;
}

interface EmployeeScheduleColumnProps {
  emp: Employee;
  /** Agendamentos do dia deste profissional, já filtrados. A referência só muda quando a lista muda,
   *  então o React.memo redesenha apenas a coluna afetada. */
  appointments: Appointment[];
}

interface ScheduleGridProviderProps {
  schedule: ScheduleGridContext;
  actions: ScheduleGridActions;
  children: React.ReactNode;
}

// Profissional de origem do card arrastado
const DRAG_SOURCE_EMPLOYEE = 'application/x-source-employee';

const ScheduleGridContextInternal = createContext<{ schedule: ScheduleGridContext; actions: ScheduleGridActions } | null>(null);

export const ScheduleGridProvider = ({ schedule, actions, children }: ScheduleGridProviderProps) => {
  const value = useMemo(() => ({ schedule, actions }), [schedule, actions]);
  return (
    <ScheduleGridContextInternal.Provider value={value}>
      {children}
    </ScheduleGridContextInternal.Provider>
  );
};

export const EmployeeScheduleColumn = React.memo(({ emp, appointments: empAppointments }: EmployeeScheduleColumnProps) => {
  const gridContext = useContext(ScheduleGridContextInternal);
  if (!gridContext) {
    throw new Error('EmployeeScheduleColumn deve ser usado dentro de ScheduleGridProvider.');
  }

  const { schedule, actions } = gridContext;
  const {
    receptionDate,
    services,
    startHour,
    endHour,
    minuteHeight,
    hourHeight,
    isTodayView,
    currentMinute,
    todayStr,
    employeeUnavailableReasons,
  } = schedule;
  const {
    onGridClick,
    onDeleteBloqueio,
    onReassignAppointment,
    onCompleteAppointment,
    onEditAppointmentClick,
    onDeleteAppointmentClick,
    setToastMessage,
    setErrorMessage,
  } = actions;

  const unavailableReason = employeeUnavailableReasons?.[emp.id] || null;
  const isUnavailable = Boolean(unavailableReason);

  const empBlockers = (emp.bloqueios || []).filter((b) => b.data === receptionDate);

  const handleDropOnColumn = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (isUnavailable) {
      setErrorMessage(`Não foi possível mover para ${emp.name}: ${unavailableReason}.`);
      return;
    }

    const appointmentId = event.dataTransfer.getData('text/plain');
    if (!appointmentId || !onReassignAppointment) return;

    // Soltar na própria coluna não muda nada (vale mesmo com busca/filtro ativos); o servidor valida o resto
    if (event.dataTransfer.getData(DRAG_SOURCE_EMPLOYEE) === emp.id) return;

    try {
      await onReassignAppointment(appointmentId, emp.id);
      setToastMessage(`Agendamento movido para ${emp.name}.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erro ao realocar agendamento.';
      setErrorMessage(msg); // Exibe o modal vermelho com a explicação do conflito CLT
    }
  };

  return (
    <div
      onClick={(e) => onGridClick(e, emp.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        void handleDropOnColumn(event);
      }}
      className={`flex-1 min-w-[220px] border-r border-outline-variant/10 relative transition-colors overflow-hidden ${isUnavailable ? 'cursor-not-allowed bg-surface-variant/20 bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(0,0,0,0.03)_5px,rgba(0,0,0,0.03)_10px)] dark:bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(255,255,255,0.02)_5px,rgba(255,255,255,0.02)_10px)]' : 'cursor-pointer hover:bg-primary/5'}`}
      style={{ height: (endHour - startHour + 1) * hourHeight }}
    >
      {isUnavailable && (
        <div className="absolute inset-0 pointer-events-none z-0 flex flex-col items-center justify-center opacity-30 grayscale">
           <div className="sticky top-1/2 -translate-y-1/2 flex flex-col items-center justify-center text-on-surface-variant">
             <span className="material-symbols-outlined text-4xl mb-2">event_busy</span>
             <span className="text-xs font-bold uppercase tracking-widest bg-surface-container/80 px-3 py-1 rounded-full shadow-sm backdrop-blur-sm border border-outline-variant/20">Profissional Indisponível</span>
           </div>
        </div>
      )}

      {empBlockers.map((bloq) => {
        const [sH, sM] = bloq.horaInicio.split(':').map(Number);
        const [eH, eM] = bloq.horaFim.split(':').map(Number);
        const top = ((sH - startHour) * 60 + sM) * minuteHeight;
        const endTop = ((eH - startHour) * 60 + eM) * minuteHeight;
        const height = Math.max(endTop - top, 20);

        return (
          <div
            key={bloq.id}
            className="absolute left-1 right-1 bg-surface-container-high/60 backdrop-blur-sm rounded-lg border border-outline-variant/30 flex items-center justify-center group overflow-hidden"
            style={{ top, height }}
          >
            <div className="absolute inset-0 opacity-10 repeating-linear-gradient-45 from-transparent to-on-surface-variant"></div>
            <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant z-10 truncate px-2">{bloq.motivo}</span>
            {onDeleteBloqueio && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteBloqueio(bloq.id);
                }}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 text-on-surface hover:text-error bg-surface shadow-sm rounded-full z-20 transition-all"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span>
              </button>
            )}
          </div>
        );
      })}

      {empAppointments.map((app) => {
        const isCompleted = app.status === 'completed';
        const appDateTime = new Date(`${app.date}T${app.time}:00`);
        const isPastDay = app.date < todayStr;
        const isNoShow = !isCompleted && isPastDay;

        const [appH, appM] = app.time.split(':').map(Number);
        const top = ((appH - startHour) * 60 + appM) * minuteHeight;
        const durationMins = getDuration(app.services, services);
        const height = Math.max(durationMins * minuteHeight, 36);
        const fimMin = appH * 60 + appM + durationMins;
        const horaFim = `${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
        const delayMinutes = (!isCompleted && isTodayView && currentMinute > appDateTime)
          ? Math.floor((currentMinute.getTime() - appDateTime.getTime()) / 60000)
          : 0;

        const startTime = appDateTime.getTime();
        const endTime = startTime + durationMins * 60 * 1000;
        const nowTime = currentMinute.getTime();
        const fifteenMinutes = 15 * 60 * 1000;

        let visualStatus: 'agendado' | 'aguardando' | 'em_atendimento' | 'finalizado' | 'falta' = 'agendado';
        if (isCompleted) {
          visualStatus = 'finalizado';
        } else if (isNoShow) {
          visualStatus = 'falta';
        } else if (isTodayView) {
          if (nowTime < startTime - fifteenMinutes) {
            visualStatus = 'agendado';
          } else if (nowTime >= startTime - fifteenMinutes && nowTime < startTime) {
            visualStatus = 'aguardando';
          } else if (nowTime >= startTime && nowTime <= endTime) {
            visualStatus = 'em_atendimento';
          } else if (nowTime > endTime) {
            visualStatus = 'falta';
          }
        }

        const statusClassMap = {
          agendado: {
            card: 'bg-amber-500/15 border-amber-400/45 shadow-sm',
            side: 'bg-amber-400',
            text: 'text-amber-300',
          },
          aguardando: {
            card: 'bg-sky-500/15 border-sky-400/45 shadow-sm',
            side: 'bg-sky-400',
            text: 'text-sky-300',
          },
          em_atendimento: {
            card: 'bg-emerald-500/15 border-emerald-400/45 shadow-sm',
            side: 'bg-emerald-400',
            text: 'text-emerald-300',
          },
          finalizado: {
            card: 'bg-surface-container-low/80 border-outline-variant/30 opacity-75',
            side: 'bg-outline-variant/60',
            text: 'text-outline-variant line-through',
          },
          falta: {
            card: 'bg-error-container/25 border-error/45 shadow-sm',
            side: 'bg-error',
            text: 'text-error',
          },
        } as const;

        const visualStyle = statusClassMap[visualStatus];
        const cardStatusClass = visualStyle.card;
        const sideColorClass = visualStyle.side;

        return (
          <div
            key={app.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', app.id);
              event.dataTransfer.setData(DRAG_SOURCE_EMPLOYEE, app.assignedEmployeeId);
            }}
            className={`absolute left-1 right-1 rounded-xl border ${cardStatusClass} flex flex-col group overflow-hidden transition-all hover:z-20`}
            style={{ top, height }}
          >
            <div className={`absolute top-0 bottom-0 left-0 w-1 ${sideColorClass}`}></div>
            <div className="pl-2 pr-1 py-1 flex flex-col h-full">
              <div className="flex justify-between items-start">
                <span className={`text-[10px] font-bold leading-none whitespace-nowrap ${visualStyle.text}`}>{app.time}–{horaFim}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-container-lowest/90 rounded-full shadow-sm p-0.5 border border-outline-variant/20 absolute right-1 top-1 z-30">
                  {!isCompleted && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompleteAppointment(app.id);
                        setToastMessage('Ok!');
                      }}
                      className="text-on-surface-variant hover:text-primary p-1 rounded-full"
                    >
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onEditAppointmentClick(app); }} className="text-on-surface-variant hover:text-primary p-1 rounded-full"><span className="material-symbols-outlined text-[14px]">edit</span></button>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteAppointmentClick(app.id); }} className="text-on-surface-variant hover:text-error p-1 rounded-full"><span className="material-symbols-outlined text-[14px]">cancel</span></button>
                </div>
              </div>
              <h5 className={`font-bold text-on-surface text-[11px] leading-tight mt-0.5 break-words ${height > 52 ? 'line-clamp-2' : 'truncate'}`} title={app.clientName}>{app.clientName}</h5>
              {height > 40 && <p className="text-[9px] text-on-surface-variant leading-tight line-clamp-2 mt-0.5" title={app.services.join(', ')}>{app.services.join(', ')}</p>}
              {height > 60 && app.observation && <p className="text-[8px] text-on-surface-variant my-1 italic border-l-2 border-outline-variant/30 pl-1.5 line-clamp-1">{app.observation}</p>}
              {height > 50 && (
                <div className="mt-auto flex gap-1 pt-1 border-t border-outline-variant/10">
                  <span className="bg-surface-container text-on-surface-variant text-[8px] px-1 rounded font-bold uppercase tracking-wide">{visualStatus.replace('_', ' ')}</span>
                  {delayMinutes > 0 && <span className="bg-error/10 text-error text-[8px] px-1 rounded font-bold">{delayMinutes}m atraso</span>}
                  {isNoShow && <span className="bg-error/10 text-error text-[8px] px-1 rounded font-bold">Falta</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
