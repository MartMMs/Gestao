import React, { createContext, useContext, useMemo } from 'react';
import { horarioParaMinutos, horarioValido, instanteNoFuso } from '@shared/agenda';
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

export type AcaoDeStatus = 'concluir' | 'falta' | 'reabrir';

export interface ScheduleGridActions {
  onGridClick: (e: React.MouseEvent<HTMLDivElement>, empId: string) => void;
  onDeleteBloqueio?: (id: string) => Promise<boolean | void> | void;
  onReassignAppointment?: (appointmentId: string, newEmployeeId: string, version?: string) => Promise<unknown> | void;
  // Arrastar e soltar: novo profissional e novo horário (HH:MM) de uma vez; o servidor valida conflitos
  onMoveAppointment?: (appointmentId: string, newEmployeeId: string, time: string) => void;
  // Concluir, marcar falta ou reabrir: abre a confirmação (quem chama mostra o resultado ou o erro)
  onAcaoDeStatus: (appointment: Appointment, acao: AcaoDeStatus) => void;
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
const DRAG_SOURCE_TIME = 'application/x-source-time';
// Distância entre o topo do card e o ponto onde ele foi agarrado: o card cai onde o usuário vê, não pelo cursor
const DRAG_GRAB_OFFSET = 'application/x-grab-offset';
const DRAG_DURACAO = 'application/x-duracao';
const PASSO_ARRASTE_MIN = 15;

type EstadoVisual = 'agendado' | 'totem' | 'aguardando' | 'em_atendimento' | 'sem_baixa' | 'finalizado' | 'falta';

// Cor de cada estado do atendimento na grade (a legenda usa a mesma tabela)
const ESTILO_ESTADO: Record<EstadoVisual, { card: string; side: string; text: string }> = {
  agendado: { card: 'bg-amber-500/15 border-amber-400/45 shadow-sm', side: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-300' },
  totem: { card: 'bg-violet-500/15 border-violet-400/45 shadow-sm', side: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300' },
  aguardando: { card: 'bg-sky-500/15 border-sky-400/45 shadow-sm', side: 'bg-sky-400', text: 'text-sky-700 dark:text-sky-300' },
  em_atendimento: { card: 'bg-emerald-500/15 border-emerald-400/45 shadow-sm', side: 'bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-300' },
  sem_baixa: { card: 'bg-error-container/10 border-error/50 border-dashed shadow-sm', side: 'bg-error/50', text: 'text-error' },
  finalizado: { card: 'bg-surface-container-low/80 border-outline-variant/30', side: 'bg-outline', text: 'text-on-surface-variant line-through' },
  falta: { card: 'bg-error-container/25 border-error/45 shadow-sm', side: 'bg-error', text: 'text-error' },
};

const ROTULO_ESTADO: Record<EstadoVisual, string> = {
  agendado: 'Agendado',
  totem: 'Totem · aguardando chegada',
  aguardando: 'Chega em 15 min',
  em_atendimento: 'Em atendimento',
  sem_baixa: 'Sem baixa (conclua ou marque falta)',
  finalizado: 'Concluído',
  falta: 'Falta',
};

// Legenda das cores da grade
export function LegendaEstadosAgenda() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legenda de cores da agenda">
      {(Object.keys(ESTILO_ESTADO) as EstadoVisual[]).map((estado) => (
        <span key={estado} className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
          <span className={`w-3 h-3 rounded-full ring-1 ring-on-surface/25 ${ESTILO_ESTADO[estado].side}`} />
          {ROTULO_ESTADO[estado]}
        </span>
      ))}
    </div>
  );
}

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
    onMoveAppointment,
    onAcaoDeStatus,
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
    if (!appointmentId) return;
    const mesmoProfissional = event.dataTransfer.getData(DRAG_SOURCE_EMPLOYEE) === emp.id;

    // Horário pela posição do topo do card, arredondado para 15 minutos e dentro do expediente da grade
    const grade = event.currentTarget.getBoundingClientRect();
    const offset = Number(event.dataTransfer.getData(DRAG_GRAB_OFFSET)) || 0;
    const minutosBrutos = startHour * 60 + ((event.clientY - grade.top - offset) / hourHeight) * 60;
    // O fim do atendimento também precisa caber na grade (soltar no rodapé não pode passar do expediente)
    const duracao = Number(event.dataTransfer.getData(DRAG_DURACAO)) || PASSO_ARRASTE_MIN;
    const ultimoInicio = Math.floor((endHour * 60 - duracao) / PASSO_ARRASTE_MIN) * PASSO_ARRASTE_MIN;
    const minutos = Math.min(Math.max(Math.round(minutosBrutos / PASSO_ARRASTE_MIN) * PASSO_ARRASTE_MIN, startHour * 60), Math.max(ultimoInicio, startHour * 60));
    // Solto a menos de meio passo de onde estava: mantém o horário original (10:10 não vira 10:15 por arredondamento)
    const horarioOrigem = event.dataTransfer.getData(DRAG_SOURCE_TIME);
    const ficouNoLugar = horarioValido(horarioOrigem) && Math.abs(minutosBrutos - horarioParaMinutos(horarioOrigem)) < PASSO_ARRASTE_MIN / 2;
    const horario = ficouNoLugar ? horarioOrigem : `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const mesmoHorario = horarioOrigem === horario;
    if (mesmoProfissional && mesmoHorario) return;

    try {
      if (onMoveAppointment) {
        // Abre a confirmação; quem confirma grava e mostra o resultado
        onMoveAppointment(appointmentId, emp.id, horario);
        return;
      }
      // Sem remarcação disponível (ex.: tela do colaborador), soltar só troca o profissional
      if (!onReassignAppointment || mesmoProfissional) return;
      await onReassignAppointment(appointmentId, emp.id);
      setToastMessage(`Agendamento movido para ${emp.name}.`);
    } catch (error) {
      // Versão desatualizada inclusive: a mensagem do servidor já diz que a agenda foi atualizada
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
        const top = (horarioParaMinutos(bloq.horaInicio) - startHour * 60) * minuteHeight;
        const endTop = (horarioParaMinutos(bloq.horaFim) - startHour * 60) * minuteHeight;
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
        // Instante no fuso do negócio (o navegador pode estar em outro fuso)
        const appDateTime = instanteNoFuso(app.date, app.time);
        const isPastDay = app.date < todayStr;
        // Falta é o status gravado; agendado de dia passado sem baixa é outro estado ("sem baixa", abaixo)
        const isNoShow = app.status === 'no_show';

        const inicioMin = horarioParaMinutos(app.time);
        const top = (inicioMin - startHour * 60) * minuteHeight;
        const durationMins = getDuration(app.services, services);
        const height = Math.max(durationMins * minuteHeight, 36);
        const fimMin = inicioMin + durationMins;
        const horaFim = `${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}`;
        const delayMinutes = (app.status === 'scheduled' && isTodayView && currentMinute > appDateTime)
          ? Math.floor((currentMinute.getTime() - appDateTime.getTime()) / 60000)
          : 0;

        const startTime = appDateTime.getTime();
        const endTime = startTime + durationMins * 60 * 1000;
        const nowTime = currentMinute.getTime();
        const fifteenMinutes = 15 * 60 * 1000;
        const jaComecou = app.status === 'scheduled' && (isPastDay || (isTodayView && nowTime >= startTime));

        let visualStatus: EstadoVisual = 'agendado';
        if (isCompleted) {
          visualStatus = 'finalizado';
        } else if (isNoShow) {
          visualStatus = 'falta';
        } else if (isPastDay) {
          // Dia que já passou e ninguém deu baixa. Equivale a semBaixaVencido (shared/statusAgendamento.ts), mas a
          // grade de outros dias usa um relógio congelado (FROZEN_MINUTE), então decide pelo dia
          visualStatus = 'sem_baixa';
        } else if (isTodayView) {
          if (nowTime < startTime - fifteenMinutes) {
            visualStatus = 'agendado';
          } else if (nowTime >= startTime - fifteenMinutes && nowTime < startTime) {
            visualStatus = 'aguardando';
          } else if (nowTime >= startTime && nowTime <= endTime) {
            visualStatus = 'em_atendimento';
          } else if (nowTime > endTime) {
            visualStatus = 'sem_baixa';
          }
        }
        // Reserva do totem ainda sem check-in: cor própria até a recepção confirmar a chegada
        if (app.aguardandoCheckin && app.status === 'scheduled' && (visualStatus === 'agendado' || visualStatus === 'aguardando')) {
          visualStatus = 'totem';
        }

        const statusClassMap = ESTILO_ESTADO;

        const visualStyle = statusClassMap[visualStatus];
        const cardStatusClass = visualStyle.card;
        const sideColorClass = visualStyle.side;

        return (
          <div
            key={app.id}
            // Só atendimento marcado se move; concluído e falta são registro do que aconteceu
            draggable={app.status === 'scheduled'}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', app.id);
              event.dataTransfer.setData(DRAG_SOURCE_EMPLOYEE, app.assignedEmployeeId);
              event.dataTransfer.setData(DRAG_SOURCE_TIME, app.time);
              event.dataTransfer.setData(DRAG_DURACAO, String(durationMins));
              event.dataTransfer.setData(DRAG_GRAB_OFFSET, String(event.clientY - event.currentTarget.getBoundingClientRect().top));
            }}
            className={`absolute left-1 right-1 rounded-xl border ${cardStatusClass} flex flex-col group overflow-hidden transition-all hover:z-20`}
            style={{ top, height }}
          >
            <div className={`absolute top-0 bottom-0 left-0 w-1 ${sideColorClass}`}></div>
            <div className="pl-2 pr-1 py-1 flex flex-col h-full">
              {/* No mouse, os botões flutuam sobre o card ao passar o cursor; no toque (sempre visíveis) eles entram na
                  linha do horário, para não cobrir o nome do cliente */}
              <div className="flex justify-between items-start flex-wrap gap-0.5">
                <span className={`text-[10px] font-bold leading-none whitespace-nowrap ${visualStyle.text}`}>{app.time}–{horaFim}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:static [@media(hover:none)]:shadow-none transition-opacity bg-surface-container-lowest/90 rounded-full shadow-sm p-0.5 border border-outline-variant/20 absolute right-1 top-1 z-30">
                  {/* Concluir e falta só depois do início (o servidor também confere) */}
                  {jaComecou && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onAcaoDeStatus(app, 'concluir'); }}
                      className="text-on-surface-variant hover:text-primary p-1 rounded-full"
                      title="Concluir" aria-label={`Concluir o atendimento de ${app.clientName}`}
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">check_circle</span>
                    </button>
                  )}
                  {jaComecou && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onAcaoDeStatus(app, 'falta'); }}
                      className="text-on-surface-variant hover:text-error p-1 rounded-full"
                      title="Marcar falta" aria-label={`Marcar falta de ${app.clientName}`}
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">person_off</span>
                    </button>
                  )}
                  {(isCompleted || isNoShow) && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onAcaoDeStatus(app, 'reabrir'); }}
                      className="text-on-surface-variant hover:text-primary p-1 rounded-full"
                      title="Reabrir (registrado por engano)" aria-label={`Reabrir o atendimento de ${app.clientName}`}
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">undo</span>
                    </button>
                  )}
                  <button type="button" onClick={(e) => { e.stopPropagation(); onEditAppointmentClick(app); }} className="text-on-surface-variant hover:text-primary p-1 rounded-full" title="Editar" aria-label={`Editar o atendimento de ${app.clientName}`}><span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit</span></button>
                  {/* Concluído e falta não se excluem (entram no faturamento e nas faltas): reabrem */}
                  {!isCompleted && !isNoShow && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onDeleteAppointmentClick(app.id); }} className="text-on-surface-variant hover:text-error p-1 rounded-full" title="Excluir ou cancelar" aria-label={`Excluir ou cancelar o atendimento de ${app.clientName}`}><span className="material-symbols-outlined text-[14px]" aria-hidden="true">cancel</span></button>
                  )}
                </div>
              </div>
              <h5 className={`font-bold text-on-surface text-[11px] leading-tight mt-0.5 break-words ${height > 52 ? 'line-clamp-2' : 'truncate'}`} title={app.clientName}>{app.clientName}</h5>
              {app.aguardandoCheckin && app.status === 'scheduled' && (
                <span className="inline-block mt-0.5 rounded-full bg-amber-500/15 px-1.5 text-[9px] font-bold uppercase tracking-wide text-amber-700" title="Reserva do totem: abra o agendamento e confirme a chegada do cliente para liberar a ficha">
                  Totem · confirmar chegada
                </span>
              )}
              {height > 40 && <p className="text-[9px] text-on-surface-variant leading-tight line-clamp-2 mt-0.5" title={app.services.join(', ')}>{app.services.join(', ')}</p>}
              {height > 60 && app.observation && <p className="text-[8px] text-on-surface-variant my-1 italic border-l-2 border-outline-variant/30 pl-1.5 line-clamp-1">{app.observation}</p>}
              {height > 50 && (
                <div className="mt-auto flex gap-1 pt-1 border-t border-outline-variant/10">
                  <span className="bg-surface-container text-on-surface-variant text-[8px] px-1 rounded font-bold uppercase tracking-wide">{ROTULO_ESTADO[visualStatus]}</span>
                  {delayMinutes > 0 && <span className="bg-error/10 text-error text-[8px] px-1 rounded font-bold">{delayMinutes}m atraso</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
