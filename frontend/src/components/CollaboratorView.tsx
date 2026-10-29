import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { horarioParaMinutos, minutoDentroDoBloqueio } from '@shared/agenda';
import { useToast } from '../hooks/useToast';
import { Employee, Appointment, Service, Client, Bloqueio } from '../types';
import { getBrazilCurrentMinuteOfDay, getLocalTodayString, getDuration, matchesAppointmentSearch } from '../features/appointments/utils/appointmentCore';
import { SCHEDULE_CONFIG } from '../config/scheduleConfig';
import { SupervisorClientesTab } from '../features/clients/components';
import { motion } from 'motion/react';
import { BookingModal, EditAppointmentModal, DeleteAppointmentModal } from '../features/appointments/components';
import { UpcomingAppointmentsModal } from './UpcomingAppointmentsModal';
import { useScheduleModals } from '../features/appointments/hooks';
import { ScheduleRulerGrid } from './ScheduleRulerGrid';
import { SolicitarTroca, type TrocaTurnoPayload } from './SolicitarTroca';

const { START_HOUR, END_HOUR, HOUR_HEIGHT, MINUTE_HEIGHT, CURRENT_TIME_LINE } = SCHEDULE_CONFIG;

interface CollaboratorViewProps {
  currentUser: Employee;
  employees: Employee[];
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  onCompleteAppointment: (id: string) => Promise<unknown> | void;
  onAddAppointment: (appointment: Omit<Appointment, 'id' | 'status'>) => Promise<boolean | void> | void;
  isAddingAppointment?: boolean;
  onEditAppointment?: (id: string, appointment: Partial<Appointment>) => Promise<boolean | void> | void;
  onDeleteAppointment?: (id: string) => Promise<boolean | void> | void;
  onEditClient?: (id: string, clientData: Partial<Client>) => Promise<boolean | void> | void;
  onDeleteClient?: (id: string) => Promise<boolean | void> | void;
  onAddBloqueio?: (b: Omit<Bloqueio, 'id'>) => Promise<boolean | void>;
  onDeleteBloqueio?: (id: string) => Promise<boolean | void>;
  onSubmitTurnoSwapRequest?: (payload: TrocaTurnoPayload) => Promise<boolean | void> | boolean | void;
}

export function CollaboratorView({
  currentUser,
  employees,
  appointments,
  services,
  clients,
  onCompleteAppointment,
  onAddAppointment,
  isAddingAppointment,
  onEditAppointment,
  onDeleteAppointment,
  onEditClient,
  onDeleteClient,
  onAddBloqueio,
  onDeleteBloqueio,
  onSubmitTurnoSwapRequest,
}: CollaboratorViewProps) {
  const [receptionDate, setReceptionDate] = useState(getLocalTodayString());
  const { toastMessage, setToastMessage } = useToast();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentMinute, setCurrentMinute] = useState(new Date());
  const [scheduleSearchTerm, setScheduleSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'agenda' | 'clientes'>('agenda');
  const [showUpcomingAppointments, setShowUpcomingAppointments] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showFolgas, setShowFolgas] = useState(false);
  const [showMyScheduleModal, setShowMyScheduleModal] = useState(false);
  const WEEK_DAYS = [
    { value: '0', label: 'DOM' },
    { value: '1', label: 'SEG' },
    { value: '2', label: 'TER' },
    { value: '3', label: 'QUA' },
    { value: '4', label: 'QUI' },
    { value: '5', label: 'SEX' },
    { value: '6', label: 'SÁB' },
  ];
  const {
    state: {
      showNewBookingModal,
      editingAppointment,
      appointmentToDelete,
      initialBookTime,
      initialBookEmp,
    },
    openBookingModal,
    closeBookingModal,
    openEditAppointmentModal,
    closeEditAppointmentModal,
    openDeleteAppointmentModal,
    closeDeleteAppointmentModal,
  } = useScheduleModals({ defaultEmployeeId: currentUser.id });

  const myScheduleDaySet = useMemo(() => {
    return new Set((currentUser.diasTrabalho || '1,2,3,4,5,6').split(',').filter(Boolean));
  }, [currentUser.diasTrabalho]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentMinute(new Date()), 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Filtra para mostrar apenas os agendamentos do colaborador logado
  const myAppointments = useMemo(() => 
    appointments.filter(a => a.assignedEmployeeId === currentUser.id), 
    [appointments, currentUser.id]
  );

  // Filtra os agendamentos para a data selecionada
  const appointmentsForSelectedDate = useMemo(() => 
    myAppointments.filter(a => a.date === receptionDate), 
    [myAppointments, receptionDate]
  );

  const filteredAppointmentsForSelectedDate = useMemo(() => {
    return appointmentsForSelectedDate.filter(app => matchesAppointmentSearch(app, scheduleSearchTerm));
  }, [appointmentsForSelectedDate, scheduleSearchTerm]);

  const myBlockers = useMemo(() => 
    (currentUser.bloqueios || []).filter(b => b.data === receptionDate),
    [currentUser.bloqueios, receptionDate]
  );

  // Calcula as estatísticas pessoais
  const { completedCount, averageRating, nextClient } = useMemo(() => {
    const todayStr = getLocalTodayString();
    const next = myAppointments
      .filter(a => a.date === todayStr && a.status === 'scheduled')
      .sort((a, b) => a.time.localeCompare(b.time))[0];

    return {
      completedCount: currentUser.completedServices,
      averageRating: currentUser.rating,
      nextClient: next,
    };
  }, [myAppointments, currentUser]);

  const handleComplete = async (id: string) => {
    try {
      await onCompleteAppointment(id);
      setToastMessage('Atendimento concluído com sucesso!');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível concluir o atendimento.');
    }
  };

  const handleGridClick = useCallback((e: React.MouseEvent<HTMLDivElement>, empId: string) => {
    if (e.target !== e.currentTarget) return; // ignore clicks on events
    const totalMinutes = e.nativeEvent.offsetY / MINUTE_HEIGHT;
    const hours = Math.floor(totalMinutes / 60) + START_HOUR;
    const minutes = Math.floor(totalMinutes % 60);
    const roundedMinutes = Math.round(minutes / 15) * 15;
    let finalHours = hours; let finalMins = roundedMinutes;
    if (finalMins === 60) { finalHours += 1; finalMins = 0; }

    const clickedMinutes = finalHours * 60 + finalMins;
    const blockingReason = (currentUser.bloqueios || []).find(
      (bloq) => bloq.data === receptionDate && minutoDentroDoBloqueio(clickedMinutes, bloq),
    );

    if (blockingReason) {
      setErrorMessage(`Horário bloqueado: ${blockingReason.motivo}.`);
      return;
    }

    openBookingModal(`${finalHours.toString().padStart(2, '0')}:${finalMins.toString().padStart(2, '0')}`, empId);
  }, [currentUser.bloqueios, openBookingModal, receptionDate]);

  const handleEditAppointmentClick = useCallback((app: Appointment) => openEditAppointmentModal(app), [openEditAppointmentModal]);

  const handleDeleteAppointmentClick = useCallback((id: string) => openDeleteAppointmentModal(id), [openDeleteAppointmentModal]);

  const handleSubmitSwapRequest = useCallback(async (_payload: TrocaTurnoPayload) => {
    if (onSubmitTurnoSwapRequest) {
      return onSubmitTurnoSwapRequest(_payload);
    }
    return true;
  }, [onSubmitTurnoSwapRequest]);

  // Lógica de renderização da linha do tempo (simplificada da SupervisorView)
  const todayStr = getLocalTodayString();
  const isTodayView = receptionDate === todayStr;
  const currentMinuteTop = isTodayView ? (getBrazilCurrentMinuteOfDay() - START_HOUR * 60) * MINUTE_HEIGHT : -100;
  const timelineHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-12">
        <h1 className="text-4xl font-headline text-primary mb-2">Portal do <span className="italic">Colaborador</span>.</h1>
        <p className="text-on-surface-variant font-body">Bem-vindo(a), {currentUser.name.split(' ')[0]}. Acompanhe sua agenda e seus clientes.</p>
      </div>

      <div className="flex bg-surface-container-low p-1 rounded-full border border-outline-variant/20 overflow-x-auto max-w-full mb-8">
        <button
          onClick={() => setActiveTab('agenda')}
          className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'agenda' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
        >
          Agenda
        </button>
        <button
          onClick={() => setActiveTab('clientes')}
          className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'clientes' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
        >
          Clientes
        </button>
      </div>

      {/* Cards de Estatísticas */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8 ${activeTab === 'agenda' ? '' : 'hidden'}`}>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Atendimentos Concluídos</p>
          <p className="text-4xl font-headline text-primary">{completedCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Sua Média</p>
          <div className="flex items-center gap-2">
            <p className="text-4xl font-headline text-primary">{averageRating.toFixed(1)}</p>
            <span className="material-symbols-outlined text-primary star-active text-2xl">star</span>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Próximo Cliente (Hoje)</p>
          {nextClient ? (
            <div className="flex items-center gap-3 mt-1">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-primary leading-tight truncate">{nextClient.clientName}</p>
                <p className="text-xs text-on-surface-variant font-medium">{nextClient.time}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant italic mt-2">Agenda de hoje finalizada.</p>
          )}
        </div>
      </motion.div>

      {/* Visualização da Agenda */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className={`bg-surface-container-lowest p-6 lg:p-8 rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden flex flex-col ${activeTab === 'agenda' ? '' : 'hidden'}`}>
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end mb-6 gap-4 shrink-0">
          <div className="w-full lg:w-auto">
            <h3 className="text-xl sm:text-2xl font-headline text-primary leading-tight">Minha Agenda</h3>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-tight mt-1">Dia em foco: {receptionDate.split('-').reverse().join('/')}</p>
            <div className="relative w-full lg:w-80 mt-3">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">search</span>
              <input
                type="text"
                value={scheduleSearchTerm}
                onChange={e => setScheduleSearchTerm(e.target.value)}
                placeholder="Buscar cliente ou serviço..."
                className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <input 
              type="date" 
              value={receptionDate} 
              onChange={e => setReceptionDate(e.target.value)}
              className="w-full sm:w-auto bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface px-4 py-2 cursor-pointer"
            />
            <button onClick={() => openBookingModal('', currentUser.id)} className="bg-primary text-on-primary px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all shadow-sm hover:bg-primary-dim flex items-center gap-1 whitespace-nowrap">
              <span className="material-symbols-outlined text-[18px]">add</span> Agendar
            </button>
            <button onClick={() => setShowFolgas(true)} className="bg-surface-container-low text-on-surface px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all shadow-sm hover:bg-surface-container-high border border-outline-variant/20 flex items-center gap-1 whitespace-nowrap">
              <span className="material-symbols-outlined text-[18px]">event_busy</span> Minhas Folgas
            </button>
            <button onClick={() => setShowMyScheduleModal(true)} className="bg-surface-container-low text-on-surface px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all shadow-sm hover:bg-surface-container-high border border-outline-variant/20 flex items-center gap-1 whitespace-nowrap">
              <span className="material-symbols-outlined text-[18px]">schedule</span> Ver Minha Escala
            </button>
            <button onClick={() => setShowSwapModal(true)} className="bg-tertiary-container text-on-tertiary-container px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all shadow-sm hover:opacity-90 flex items-center gap-1 whitespace-nowrap">
              <span className="material-symbols-outlined text-[18px]">swap_horiz</span> Solicitar Troca
            </button>
            <button onClick={() => setShowUpcomingAppointments(true)} className="bg-secondary-container text-on-secondary-container px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold uppercase tracking-widest transition-all shadow-sm hover:bg-secondary/20 flex items-center gap-1 whitespace-nowrap">
              <span className="material-symbols-outlined text-[18px]">event_note</span> Próximos
            </button>
          </div>
        </div>

        <div className="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col shadow-sm h-[70vh]">
          {/* Cabeçalho da Coluna */}
          <div className="flex border-b border-outline-variant/20 bg-surface-container-lowest/95 backdrop-blur z-20 shrink-0">
            <div className="w-14 shrink-0 border-r border-outline-variant/10"></div> {/* Espaço para a timeline */}
            <div className="flex-1 p-2 text-center">
              <img src={currentUser.avatar} alt={currentUser.name} className="w-9 h-9 mx-auto rounded-full border-2 border-surface-container shadow-sm object-cover" />
              <h4 className="font-bold text-on-surface text-xs mt-1 truncate">{currentUser.name.split(' ')[0]}</h4>
            </div>
          </div>

          {/* Corpo da Agenda */}
          <div className="flex flex-1 overflow-y-auto relative custom-scrollbar">
            <ScheduleRulerGrid
              startHour={START_HOUR}
              endHour={END_HOUR}
              hourHeight={HOUR_HEIGHT}
              hourColumnClassName="w-14 shrink-0 bg-surface-container-lowest/95 backdrop-blur border-r border-outline-variant/20 sticky left-0 z-10 flex flex-col"
              labelClassName="absolute top-1 right-2 text-[10px] font-bold text-on-surface-variant bg-surface-container-lowest px-1 leading-none"
            />

            {/* Coluna de Agendamentos */}
            <div className="relative flex-1 z-10" onClick={(e) => handleGridClick(e, currentUser.id)} style={{ height: timelineHeight }}>

              {/* Bloqueios */}
              {myBlockers.map(bloq => {
                const top = (horarioParaMinutos(bloq.horaInicio) - START_HOUR * 60) * MINUTE_HEIGHT;
                const height = Math.max((horarioParaMinutos(bloq.horaFim) - START_HOUR * 60) * MINUTE_HEIGHT - top, 20);
                return (
                  <div key={bloq.id} className="absolute left-2 right-2 bg-surface-container-high/60 backdrop-blur-sm rounded-lg border border-outline-variant/30 flex items-center justify-center group overflow-hidden" style={{ top, height }}>
                    <div className="absolute inset-0 opacity-10 repeating-linear-gradient-45 from-transparent to-on-surface-variant"></div>
                    <span className="text-[10px] font-bold tracking-widest uppercase text-on-surface-variant z-10 truncate px-2">{bloq.motivo}</span>
                  </div>
                );
              })}
              {filteredAppointmentsForSelectedDate.length === 0 && myBlockers.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center opacity-60 pointer-events-none">
                  <span className="material-symbols-outlined text-5xl text-outline-variant mb-2">relax</span>
                  <p className="text-sm font-medium text-on-surface-variant">Nenhum agendamento para este dia.</p>
                </div>
              )}

              {/* Agendamentos */}
              {filteredAppointmentsForSelectedDate.map(app => {
                const isCompleted = app.status === 'completed';
                const appDateTime = new Date(`${app.date}T${app.time}:00`);
                const isPastDay = app.date < todayStr;
                const isNoShow = !isCompleted && isPastDay;
                
                const top = (horarioParaMinutos(app.time) - START_HOUR * 60) * MINUTE_HEIGHT;
                
                const durationMins = getDuration(app.services, services);
                const height = Math.max(durationMins * MINUTE_HEIGHT, 30);

                const delayMinutes = (!isCompleted && isTodayView && currentMinute > appDateTime) 
                  ? Math.floor((currentMinute.getTime() - appDateTime.getTime()) / 60000) 
                  : 0;

                const cardStatusClass = isCompleted ? "bg-surface-container-low/80 border-outline-variant/30 opacity-70" : (isNoShow || delayMinutes > 0) ? "bg-error-container/20 border-error/40 shadow-sm" : "bg-surface-container-lowest border-primary/20 shadow-md";
                const sideColorClass = isCompleted ? "bg-outline-variant/50" : (isNoShow || delayMinutes > 0) ? "bg-error" : "bg-primary";

                return (
                  <div
                    key={app.id}
                    onClick={(e) => { e.stopPropagation(); handleEditAppointmentClick(app); }}
                    className={`absolute left-2 right-2 rounded-xl border ${cardStatusClass} flex flex-col group overflow-hidden transition-all hover:z-20 cursor-pointer`}
                    style={{ top, height }}
                  >
                    <div className={`absolute top-0 bottom-0 left-0 w-1.5 ${sideColorClass}`}></div>
                    <div className="pl-3 pr-2 py-1.5 flex flex-col h-full">
                      <div className="flex justify-between items-start">
                        <span className={`text-xs font-bold leading-none ${isCompleted ? 'text-outline-variant line-through' : (isNoShow || delayMinutes > 0) ? 'text-error' : 'text-primary'}`}>{app.time}</span>
                        {!isCompleted && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-container-lowest/90 rounded-full shadow-sm p-1 border border-outline-variant/20 absolute right-1.5 top-1.5 z-30">
                            <button onClick={() => handleComplete(app.id)} className="text-on-surface-variant hover:text-primary p-1 rounded-full flex items-center justify-center" title="Concluir Atendimento">
                              <span className="material-symbols-outlined text-base">check_circle</span>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteAppointmentClick(app.id); }} className="text-on-surface-variant hover:text-error p-1 rounded-full" title="Cancelar Agendamento">
                              <span className="material-symbols-outlined text-base">cancel</span>
                            </button>
                          </div>
                        )}
                      </div>
                      <h5 className="font-bold text-on-surface text-sm leading-tight truncate mt-1" title={app.clientName}>{app.clientName}</h5>
                      {height > 45 && <p className="text-xs text-on-surface-variant leading-tight line-clamp-2 mt-1" title={app.services.join(', ')}>{app.services.join(', ')}</p>}
                      {height > 70 && app.observation && <p className="text-[10px] text-on-surface-variant my-1.5 italic border-l-2 border-outline-variant/30 pl-2 line-clamp-2" title={app.observation}>{app.observation}</p>}
                      {height > 55 && (
                        <div className="mt-auto flex gap-1.5 pt-1.5 border-t border-outline-variant/10">
                          {delayMinutes > 0 && <span className="bg-error/10 text-error text-[9px] px-1.5 rounded font-bold">{delayMinutes}m atraso</span>}
                          {isNoShow && <span className="bg-error/10 text-error text-[9px] px-1.5 rounded font-bold">Falta</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

                {/* Linha do Tempo Atual */}
                {isTodayView && currentMinuteTop >= 0 && currentMinuteTop <= timelineHeight && (
                  <div className={CURRENT_TIME_LINE.CONTAINER_CLASS} style={{ top: currentMinuteTop }}>
                    <div className={CURRENT_TIME_LINE.DOT_CLASS}></div>
                    <div className={CURRENT_TIME_LINE.BAR_CLASS}></div>
                  </div>
                )}
            </div>
          </div>
        </div>
      </motion.div>

      {showNewBookingModal && (
        <BookingModal
          receptionDate={receptionDate}
          initialTime={initialBookTime}
          initialEmpId={initialBookEmp}
          clients={clients}
          services={services}
          employees={employees}
          appointments={appointments}
          isAddingAppointment={isAddingAppointment}
          onClose={closeBookingModal}
          onAddAppointment={onAddAppointment}
          onEditClient={onEditClient}
          setErrorMessage={setErrorMessage}
          setToastMessage={setToastMessage}
        />
      )}

      <div className={`w-full max-w-6xl mt-8 ${activeTab === 'clientes' ? '' : 'hidden'}`}>
        <SupervisorClientesTab
          clients={clients}
          appointments={appointments}
          services={services}
          onEditClient={onEditClient}
          somenteAnamnese
          setToastMessage={setToastMessage}
        />
      </div>

      {editingAppointment && (
        <EditAppointmentModal
          appointment={editingAppointment}
          employees={employees}
          services={services}
          appointments={appointments}
          onClose={closeEditAppointmentModal}
          onEditAppointment={onEditAppointment}
          setErrorMessage={setErrorMessage}
          setToastMessage={setToastMessage}
        />
      )}

      {appointmentToDelete && onDeleteAppointment && (
        <DeleteAppointmentModal
          appointmentId={appointmentToDelete}
          onClose={closeDeleteAppointmentModal}
          onDeleteAppointment={onDeleteAppointment}
          setToastMessage={setToastMessage}
          setErrorMessage={setErrorMessage}
          modo="cancelar"
        />
      )}

      <UpcomingAppointmentsModal
        open={showUpcomingAppointments}
        appointments={appointments}
        employees={employees}
        services={services}
        onClose={() => setShowUpcomingAppointments(false)}
      />

      <SolicitarTroca
        open={showSwapModal}
        onClose={() => setShowSwapModal(false)}
        colaboradorId={currentUser.id}
        appointments={appointments}
        onSubmitTroca={handleSubmitSwapRequest}
        setErrorMessage={setErrorMessage}
        setToastMessage={setToastMessage}
      />

      {showFolgas && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-80 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowFolgas(false); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">Minhas Folgas</h3>
              <button type="button" onClick={() => setShowFolgas(false)} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">{currentUser.name}</p>
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
              {(currentUser.bloqueios || []).length === 0 ? (
                <p className="text-sm text-on-surface-variant">Nenhuma folga cadastrada.</p>
              ) : (
                (currentUser.bloqueios || []).map((bloq) => (
                  <div key={bloq.id} className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-on-surface">{bloq.motivo}</p>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary">{bloq.data}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-1">{bloq.horaInicio} - {bloq.horaFim}</p>
                  </div>
                ))
              )}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setShowFolgas(false)} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:bg-primary-dim transition-colors">Fechar</button>
            </div>
          </motion.div>
        </div>
      )}

      {showMyScheduleModal && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-80 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowMyScheduleModal(false); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">Minha Escala</h3>
              <button type="button" onClick={() => setShowMyScheduleModal(false)} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1 custom-scrollbar">
              <div>
                <p className="text-sm font-bold text-on-surface mb-2">{currentUser.name}</p>
                <p className="text-xs text-on-surface-variant">{currentUser.specialty}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-3">Dias de Trabalho</p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map((day) => (
                    <div
                      key={day.value}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-center ${myScheduleDaySet.has(day.value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {day.label}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-on-surface-variant mt-3">
                  A alteração da escala e das folgas é feita somente pela supervisão.
                </p>
              </div>

              <button type="button" onClick={() => setShowMyScheduleModal(false)} className="w-full py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-on-primary bg-primary hover:bg-primary-dim transition-colors">
                Fechar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {errorMessage && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-surface-container-lowest p-8 rounded-3xl shadow-2xl max-w-sm w-full border border-error/30 text-center">
            <span className="material-symbols-outlined text-3xl text-error mb-4">error</span>
            <h2 className="text-2xl font-headline text-error mb-2">Ops!</h2>
            <p className="text-on-surface-variant text-sm mb-6">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="w-full bg-surface-container hover:bg-surface-container-high text-on-surface py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-colors">Entendi</button>
          </motion.div>
        </div>
      )}

      {toastMessage && (
        <motion.div 
          initial={{ opacity: 0, y: 50, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          className="fixed bottom-8 right-8 bg-surface-container-highest text-on-surface border border-outline-variant/30 px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 z-100"
        >
          <span className="material-symbols-outlined text-primary">check_circle</span>
          <p className="text-sm font-bold">{toastMessage}</p>
        </motion.div>
      )}
    </div>
  );
}