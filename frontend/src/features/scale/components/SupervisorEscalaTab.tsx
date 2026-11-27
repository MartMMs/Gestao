import { formatarDataBR } from '@shared/datasBR';
import { horasDaGrade, useFuncionamento } from '../../../config/funcionamento';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { Appointment, Employee, Client, Service, Bloqueio } from '../../../types';
import { getDuration, getBrazilCurrentMinuteOfDay, getBrazilCurrentTimeString, getLocalTodayString, matchesAppointmentSearch, shiftDateString } from '../../../features/appointments/utils/appointmentCore';
import { SCHEDULE_CONFIG } from '../../../config/scheduleConfig';
import { BlockModal, BookingModal, EditAppointmentModal, DeleteAppointmentModal } from '../../../features/appointments/components';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { isApiError, useEscalaOperacional } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { useScheduleModals } from '../../../features/appointments/hooks';
import { EmployeeScheduleColumn, LegendaEstadosAgenda, ScheduleGridProvider, type AcaoDeStatus, type ScheduleGridActions, type ScheduleGridContext } from '../../../components/ScheduleGridColumn';
import { AgendaVisaoPeriodo, type VisaoAgenda } from './AgendaVisaoPeriodo';
import { ScheduleRulerGrid } from '../../../components/ScheduleRulerGrid';
import { atendeNaAgenda, formatarReais } from '../../../utils/formatters';
import { JANELA_AGENDA_DIAS } from '@shared/agendaJanela';
import { ListaSemBaixa, useSemBaixa } from './ListaSemBaixa';
import { abreNaData, bloqueioDiaInteiro, diaDaSemana, funcionamentoNaData, mensagemCasaFechada, horarioParaMinutos, INTERVALO_AGENDAMENTO_MIN, minutoDentroDoBloqueio, minutosParaHorario, validarHorarioAgendamento } from '@shared/agenda';
import type { DiaEscala } from '@shared/escala';
import { codigoReserva, lerCodigoReserva } from '@shared/codigoReserva';
import { estaDeFolga, statusDoDia, type EmployeeDayStatus } from '../utils/statusDoDia';

const { HOUR_HEIGHT, MINUTE_HEIGHT, CURRENT_TIME_LINE } = SCHEDULE_CONFIG;
// Referências fixas para listas vazias (um [] novo a cada render anularia os memos e o React.memo)
const NO_APPOINTMENTS: Appointment[] = [];
// Sentinela: fora de hoje o relógio não é lido (atraso e linha vermelha só existem na visão de hoje)
const FROZEN_MINUTE = new Date(0);
export const NO_SCALE_OVERRIDES: NonNullable<SupervisorEscalaTabProps['scaleOverrides']> = [];

interface SupervisorEscalaTabProps {
  employees: Employee[];
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  scaleOverrides?: Array<{
    colaboradorId: string;
    data: string;
    tipo: 'trabalho' | 'folga' | 'fds';
    turno?: string;
    descricao?: string;
  }>;
  onOpenUpcomingAppointments?: () => void;
  onReassignAppointment?: (appointmentId: string, newEmployeeId: string, version?: string) => Promise<unknown> | void;
  onAddAppointment: (appointment: Omit<Appointment, 'id' | 'status'>) => Promise<boolean | void> | void;
  isAddingAppointment?: boolean;
  onDeleteAppointment: (id: string, version?: string) => Promise<boolean | void> | void;
  onEditAppointment: (id: string, appointment: Partial<Appointment>) => Promise<boolean | void> | void;
  // Concluir, marcar falta ou reabrir (com a versão do atendimento); rejeita com o erro da API
  onAlterarStatus: (appointment: Appointment, status: 'completed' | 'no_show' | 'scheduled') => Promise<unknown>;
  onEditClient?: (id: string, clientData: Partial<Client>) => Promise<boolean | void> | void;
  onAddBloqueio?: (b: Omit<Bloqueio, 'id'>) => Promise<boolean | void>;
  onDeleteBloqueio?: (id: string) => Promise<boolean | void>;
  setToastMessage: (msg: string | null) => void;
  setErrorMessage: (msg: string | null) => void;
  buildScaleForEmployee?: (employeeId: string) => DiaEscala[];
  /**
   * Quem usa a agenda da casa. Recepção: não exclui (cancela, o atendimento fica no histórico) e não cria bloqueio.
   * O servidor confere as duas coisas de novo; aqui só some o que ela não pode fazer.
   */
  papel: 'supervisor' | 'recepcao'; // obrigatório: esquecer a prop não pode abrir no modo de mais poder
}


export function SupervisorEscalaTab({ employees, appointments, services, clients, scaleOverrides = NO_SCALE_OVERRIDES, onOpenUpcomingAppointments, onReassignAppointment, onAddAppointment, isAddingAppointment, onDeleteAppointment, onEditAppointment, onAlterarStatus, onEditClient, onAddBloqueio, onDeleteBloqueio, setToastMessage, setErrorMessage, buildScaleForEmployee, papel }: SupervisorEscalaTabProps) {
  const { token } = useAuth();
  const ehRecepcao = papel === 'recepcao';
  const funcionamento = useFuncionamento();
  const [receptionDate, setReceptionDate] = useState(getLocalTodayString());
  const intervalosDoDia = useMemo(() => appointments
    .filter((a) => a.date === receptionDate && a.status !== 'cancelled')
    .map((a): [number, number] => { const i = horarioParaMinutos(a.time); return [i, i + getDuration(a.services, services)]; }),
  [appointments, receptionDate, services]);
  const { horaInicioGrade, horaFimGrade } = horasDaGrade(funcionamentoNaData(funcionamento, receptionDate), intervalosDoDia);
  const [scheduleSearchTerm, setScheduleSearchTerm] = useState('');
  const [professionalFilter, setProfessionalFilter] = useState('all');
  const OFF_DAY_FILTER = '__off_today__';
  const [visao, setVisao] = useState<VisaoAgenda>('dia');
  const {
    state: {
      showNewBookingModal,
      showNewBlockModal,
      editingAppointment,
      appointmentToDelete,
      initialBookTime,
      initialBookEmp,
    },
    openBookingModal,
    closeBookingModal,
    openBlockModal,
    closeBlockModal,
    openEditAppointmentModal,
    closeEditAppointmentModal,
    openDeleteAppointmentModal,
    closeDeleteAppointmentModal,
  } = useScheduleModals();

  const todayStr = getLocalTodayString();
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  
  const [currentMinute, setCurrentMinute] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setCurrentMinute(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Lógica do Calendário à esquerda
  const [currentMonthDate, setCurrentMonthDate] = useState(new Date());
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) calendarDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) calendarDays.push(i);
  const handlePrevMonth = () => setCurrentMonthDate(new Date(year, month - 1, 1));
  const handleNextMonth = () => setCurrentMonthDate(new Date(year, month + 1, 1));
  const formatDayString = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const calendarMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const receptionMonthStr = receptionDate.slice(0, 7);

  // Recepção usa o endpoint operacional somente leitura (apenas trabalho/folga e turno do mês, sem dados sensíveis do RH)
  const { data: escalaOperacionalMes = NO_SCALE_OVERRIDES } = useEscalaOperacional(token, calendarMonthStr, { enabled: ehRecepcao });
  const { data: escalaOperacionalDia = NO_SCALE_OVERRIDES } = useEscalaOperacional(token, receptionMonthStr, {
    enabled: ehRecepcao && receptionMonthStr !== calendarMonthStr,
  });

  const effectiveScaleOverrides = useMemo(() => {
    if (!ehRecepcao) return scaleOverrides;
    if (receptionMonthStr === calendarMonthStr) return escalaOperacionalMes;
    return [...escalaOperacionalMes, ...escalaOperacionalDia];
  }, [ehRecepcao, scaleOverrides, calendarMonthStr, receptionMonthStr, escalaOperacionalMes, escalaOperacionalDia]);

  // Overrides indexados por colaborador+dia: o calendário consulta todos os dias do mês para toda a equipe
  const overrideByEmployeeDay = useMemo(() => {
    const map = new Map<string, { tipo: 'trabalho' | 'folga' | 'fds' }>();
    for (const override of effectiveScaleOverrides) map.set(`${override.colaboradorId}:${override.data}`, override);
    return map;
  }, [effectiveScaleOverrides]);

  const getDayCoverage = useCallback((dateStr: string) => {
    const team = employees.filter((emp) => atendeNaAgenda(emp));
    const ideal = Math.max(1, Math.ceil(team.length * 0.7));
    const trabalhando: string[] = [];
    const folgas: string[] = [];

    for (const emp of team) {
      const override = overrideByEmployeeDay.get(`${emp.id}:${dateStr}`);
      if (override && override.tipo !== 'trabalho') {
        folgas.push(emp.name.split(' ')[0] || emp.name);
        continue;
      }

      const fullDayBlock = (emp.bloqueios || []).find((bloq) => bloq.data === dateStr && bloqueioDiaInteiro(bloq, funcionamento));

      if (fullDayBlock) {
        folgas.push(emp.name.split(' ')[0] || emp.name);
        continue;
      }

      trabalhando.push(emp.name.split(' ')[0] || emp.name);
    }

    return {
      availableCount: trabalhando.length,
      ideal,
      trabalhando,
      folgas,
    };
  }, [employees, overrideByEmployeeDay, funcionamento]);

  const dayScaleOverrideByEmployee = useMemo(() => {
    const map = new Map<string, { tipo: 'trabalho' | 'folga' | 'fds'; descricao?: string }>();

    for (const override of effectiveScaleOverrides) {
      if (override.data !== receptionDate) continue;
      if (!override.colaboradorId || !override.tipo || override.tipo === 'trabalho') continue;
      map.set(override.colaboradorId, {
        tipo: override.tipo,
        descricao: override.descricao,
      });
    }

    return map;
  }, [effectiveScaleOverrides, receptionDate]);

  const getEmployeeDayStatus = useCallback((emp: Employee): EmployeeDayStatus | null => statusDoDia(
    buildScaleForEmployee?.(emp.id).find((d) => d.data === receptionDate),
    dayScaleOverrideByEmployee.get(emp.id),
    (emp.bloqueios || []).filter((bloq) => bloq.data === receptionDate),
    funcionamento,
  ), [dayScaleOverrideByEmployee, receptionDate, buildScaleForEmployee, funcionamento]);

  // Situação do dia de cada profissional, calculada uma vez por data (gerar a escala do mês é caro)
  const dayStatusByEmployee = useMemo(() => {
    const map = new Map<string, EmployeeDayStatus | null>();
    for (const emp of employees) {
      if (atendeNaAgenda(emp)) map.set(emp.id, getEmployeeDayStatus(emp));
    }
    return map;
  }, [employees, getEmployeeDayStatus]);

  // Lógica de Scroll e Interações Visuais
  const scrollHorizontally = (direction: 'left' | 'right') => {
    if (bodyScrollRef.current) bodyScrollRef.current.scrollBy({ left: direction === 'left' ? -300 : 300, behavior: 'smooth' });
  };

  const scrollToCurrentTime = () => {
    if (bodyScrollRef.current) {
      const currentMinuteTop = (getBrazilCurrentMinuteOfDay() - horaInicioGrade * 60) * (HOUR_HEIGHT / 60);
      bodyScrollRef.current.scrollTo({ top: Math.max(0, currentMinuteTop - 100), behavior: 'smooth' });
    }
  };

  const handleGridClick = useCallback((e: React.MouseEvent<HTMLDivElement>, empId: string) => {
    if (e.target !== e.currentTarget) return;
    const y = e.nativeEvent.offsetY;
    const totalMinutes = y / MINUTE_HEIGHT;
    const hours = Math.floor(totalMinutes / 60) + horaInicioGrade;
    const minutes = Math.floor(totalMinutes % 60);
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    let finalHours = hours; let finalMins = roundedMinutes;
    if (finalMins === 60) { finalHours += 1; finalMins = 0; }
    const formattedTime = `${finalHours.toString().padStart(2, '0')}:${finalMins.toString().padStart(2, '0')}`;

    const selectedEmployee = employees.find((emp) => emp.id === empId);
    if (!selectedEmployee) return;

    const dayStatus = dayStatusByEmployee.get(empId);
    if (dayStatus?.isAllDayUnavailable) {
      setErrorMessage(`Profissional indisponível: ${dayStatus.label}${dayStatus.reason ? ` (${dayStatus.reason})` : ''}.`);
      return;
    }

    // Dia fechado, antes da abertura ou depois do último horário: avisa já no clique, não depois de preencher a reserva
    const foraDoHorario = validarHorarioAgendamento(receptionDate, formattedTime, INTERVALO_AGENDAMENTO_MIN, { funcionamento });
    if (foraDoHorario) {
      setErrorMessage(foraDoHorario);
      return;
    }

    const clickedMinutes = finalHours * 60 + finalMins;
    const blockingReason = (selectedEmployee?.bloqueios || []).find(
      (bloq) => bloq.data === receptionDate && minutoDentroDoBloqueio(clickedMinutes, bloq),
    );

    if (blockingReason) {
      setErrorMessage(`Horário bloqueado para ${selectedEmployee?.name || 'este profissional'}: ${blockingReason.motivo}.`);
      return;
    }

    if (receptionDate === todayStr) {
      const currentTime = getBrazilCurrentTimeString();
      if (formattedTime < currentTime) {
        setErrorMessage('Não é possível agendar horários anteriores à linha vermelha.');
        return;
      }
    }
    openBookingModal(formattedTime, empId);
  }, [employees, receptionDate, setErrorMessage, todayStr, dayStatusByEmployee, openBookingModal, horaInicioGrade, funcionamento]);

  const activeEmployees = useMemo(() => employees
    .filter((emp) => atendeNaAgenda(emp))
    .filter((emp) => {
      if (professionalFilter === 'all') return true;
      if (professionalFilter === OFF_DAY_FILTER) return estaDeFolga(dayStatusByEmployee.get(emp.id));
      return emp.id === professionalFilter;
    }), [employees, professionalFilter, dayStatusByEmployee]);

  const employeeUnavailableReasons = useMemo(() => {
    const reasons: Record<string, string> = {};
    for (const emp of activeEmployees) {
      const status = dayStatusByEmployee.get(emp.id);
      if (status?.isAllDayUnavailable) {
        reasons[emp.id] = `${status.label}: ${status.reason}`;
      }
    }
    return reasons;
  }, [activeEmployees, dayStatusByEmployee]);

  const isTodayView = receptionDate === todayStr;
  // Mesma janela do servidor (GET /agendamentos devolve só o último ano)
  const isOutsideLoadedWindow = receptionDate < shiftDateString(todayStr, -JANELA_AGENDA_DIAS);
  const currentMinuteTop = isTodayView ? (getBrazilCurrentMinuteOfDay() - horaInicioGrade * 60) * MINUTE_HEIGHT : -100;
  const timelineHeight = (horaFimGrade - horaInicioGrade + 1) * HOUR_HEIGHT;

  // Agendamentos do dia já filtrados e agrupados por profissional: cada coluna só lê a própria lista
  // Listas sem mudança reaproveitam o array anterior (o React Query mantém os objetos inalterados),
  // assim só a coluna do profissional afetado redesenha.
  const previousDayAppointmentsRef = useRef(new Map<string, Appointment[]>());
  const dayAppointmentsByEmployee = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of appointments) {
      if (appointment.date !== receptionDate) continue;
      if (!matchesAppointmentSearch(appointment, scheduleSearchTerm)) continue;
      const list = map.get(appointment.assignedEmployeeId);
      if (list) list.push(appointment);
      else map.set(appointment.assignedEmployeeId, [appointment]);
    }
    const previous = previousDayAppointmentsRef.current;
    for (const [employeeId, list] of map) {
      const old = previous.get(employeeId);
      if (old && old.length === list.length && old.every((item, index) => item === list[index])) map.set(employeeId, old);
    }
    previousDayAppointmentsRef.current = map;
    return map;
  }, [appointments, receptionDate, scheduleSearchTerm]);

  // Semana e mês: mesmos filtros da grade (busca e profissional), sem limitar ao dia
  const periodAppointments = useMemo(() => appointments.filter((appointment) => (
    (professionalFilter === 'all' || professionalFilter === OFF_DAY_FILTER || appointment.assignedEmployeeId === professionalFilter)
    && matchesAppointmentSearch(appointment, scheduleSearchTerm)
  )), [appointments, professionalFilter, scheduleSearchTerm]);

  const scheduleGridContext = useMemo<ScheduleGridContext>(() => ({
    receptionDate,
    services,
    startHour: horaInicioGrade,
    endHour: horaFimGrade,
    minuteHeight: MINUTE_HEIGHT,
    hourHeight: HOUR_HEIGHT,
    isTodayView,
    // Fora de hoje o relógio não é usado: um valor fixo evita redesenhar todas as colunas a cada minuto
    currentMinute: isTodayView ? currentMinute : FROZEN_MINUTE,
    todayStr,
    employeeUnavailableReasons,
  }), [receptionDate, services, isTodayView, currentMinute, todayStr, employeeUnavailableReasons]);

  const [mostrarSemBaixa, setMostrarSemBaixa] = useState(false);
  const semBaixa = useSemBaixa(appointments, services);
  const abrirAtendimento = (app: Appointment) => {
    setReceptionDate(app.date);
    setVisao('dia');
    setMostrarSemBaixa(false);
    openEditAppointmentModal(app);
  };

  // Enter com um código de reserva: vai para o dia do atendimento e abre o agendamento
  const abrirPorCodigo = () => {
    const codigo = lerCodigoReserva(scheduleSearchTerm);
    if (!codigo) return;
    const achado = appointments.find((a) => codigoReserva(a.id) === codigo);
    if (!achado) { setErrorMessage(`Nenhuma reserva ${codigo} na agenda (canceladas e de mais de um ano não aparecem).`); return; }
    abrirAtendimento(achado);
  };

  // Arrastar o card: muda profissional e horário juntos. Vai só o necessário (o servidor mantém cliente e serviços)
  // e a versão do registro, para não sobrescrever uma edição feita por outra pessoa nesse meio tempo
  const appointmentsRef = useRef(appointments);
  appointmentsRef.current = appointments;
  // Soltar o card não grava direto: um arrasto sem querer remarcaria o cliente. A confirmação mostra o antes e o
  // depois, grava e mostra o resultado (nada fica esperando no card que foi solto)
  const [movimentoPendente, setMovimentoPendente] = useState<{ app: Appointment; empId: string; time: string } | null>(null);
  const [movendo, setMovendo] = useState(false);
  const handleMoveAppointment = useCallback((appointmentId: string, newEmployeeId: string, time: string) => {
    const app = appointmentsRef.current.find((a) => a.id === appointmentId);
    if (!app) {
      setErrorMessage('Agendamento não encontrado. Atualize a agenda e tente novamente.');
      return;
    }
    setMovimentoPendente({ app, empId: newEmployeeId, time });
  }, [setErrorMessage]);
  const confirmarMovimento = async () => {
    if (!movimentoPendente || movendo) return;
    const { app, empId, time } = movimentoPendente;
    setMovendo(true);
    try {
      const resultado = await onEditAppointment(app.id, { date: app.date, time, assignedEmployeeId: empId, version: app.version });
      if (resultado === false) setErrorMessage('Não foi possível mover o agendamento.');
      else setToastMessage(empId === app.assignedEmployeeId ? `Agendamento remarcado para ${time}.` : `Agendamento movido para ${nomeProfissional(empId)} às ${time}.`);
    } catch (error) {
      // Versão desatualizada inclusive: a mensagem do servidor já diz que a agenda foi atualizada
      setErrorMessage(isApiError(error) ? error.message : 'Não foi possível mover o agendamento.');
    } finally {
      setMovendo(false);
      setMovimentoPendente(null);
    }
  };
  const cancelarMovimento = () => setMovimentoPendente(null);
  const nomeProfissional = (id: string) => employees.find((e) => e.id === id)?.name ?? 'profissional';
  const descricaoMovimento = (() => {
    if (!movimentoPendente) return '';
    const { app, empId, time } = movimentoPendente;
    const duracao = getDuration(app.services, services);
    const intervalo = (inicio: string) => `${inicio}–${minutosParaHorario(horarioParaMinutos(inicio) + duracao)}`;
    const dia = formatarDataBR(app.date);
    return `${app.clientName}, ${dia}: de ${intervalo(app.time)} com ${nomeProfissional(app.assignedEmployeeId)} para ${intervalo(time)} com ${nomeProfissional(empId)}.`;
  })();

  // Concluir, falta e reabrir mexem em faturamento, comissão e faltas: sempre com confirmação, esperando a resposta
  const [acaoPendente, setAcaoPendente] = useState<{ app: Appointment; acao: AcaoDeStatus } | null>(null);
  const [aplicandoAcao, setAplicandoAcao] = useState(false);
  const pedirAcaoDeStatus = useCallback((app: Appointment, acao: AcaoDeStatus) => setAcaoPendente({ app, acao }), []);
  const confirmarAcaoDeStatus = async () => {
    if (!acaoPendente || aplicandoAcao) return;
    const { app, acao } = acaoPendente;
    setAplicandoAcao(true);
    try {
      await onAlterarStatus(app, acao === 'concluir' ? 'completed' : acao === 'falta' ? 'no_show' : 'scheduled');
      setToastMessage(acao === 'concluir' ? 'Atendimento concluído.' : acao === 'falta' ? 'Falta registrada.' : 'Atendimento reaberto.');
      setAcaoPendente(null);
    } catch (error) {
      setAcaoPendente(null);
      // Versão desatualizada inclusive: a mensagem do servidor já diz que a agenda foi atualizada
      setErrorMessage(isApiError(error) ? error.message : 'Não foi possível alterar o atendimento.');
    } finally {
      setAplicandoAcao(false);
    }
  };
  // O atendimento mudou (outra aba, outra pessoa, aviso em tempo real) com a confirmação aberta: ela fecha, em vez
  // de pedir para confirmar algo que já não está na tela
  useEffect(() => {
    const pendente = acaoPendente?.app ?? movimentoPendente?.app;
    if (!pendente || aplicandoAcao || movendo) return;
    const atual = appointments.find((a) => a.id === pendente.id);
    if (atual && atual.version === pendente.version) return;
    setAcaoPendente(null);
    setMovimentoPendente(null);
    setErrorMessage('Este atendimento mudou enquanto a confirmação estava aberta. A agenda foi atualizada: confira e tente de novo.');
  }, [appointments, acaoPendente, movimentoPendente, aplicandoAcao, movendo, setErrorMessage]);
  const textoAcao = (() => {
    if (!acaoPendente) return { titulo: '', descricao: '', botao: '' };
    const { app, acao } = acaoPendente;
    const quando = `${formatarDataBR(app.date)} às ${app.time}, com ${nomeProfissional(app.assignedEmployeeId)}`;
    if (acao === 'concluir') {
      const valor = typeof app.valorTotal === 'number' ? ` (${formatarReais(app.valorTotal)})` : '';
      return { titulo: 'Concluir atendimento?', descricao: `${app.clientName}, ${quando}. Ele entra no faturamento${valor} e na comissão.`, botao: 'Concluir' };
    }
    if (acao === 'falta') return { titulo: 'Marcar falta?', descricao: `${app.clientName}, ${quando}. O horário fica registrado como falta do cliente.`, botao: 'Marcar falta' };
    return {
      titulo: 'Reabrir atendimento?',
      descricao: `${app.clientName}, ${quando}. Ele volta a ficar agendado (sai do faturamento e das faltas até uma nova baixa). A reabertura fica no histórico de alterações.`,
      botao: 'Reabrir',
    };
  })();

  const scheduleGridActions = useMemo<ScheduleGridActions>(() => ({
    onGridClick: handleGridClick,
    onDeleteBloqueio,
    onReassignAppointment,
    onMoveAppointment: handleMoveAppointment,
    onAcaoDeStatus: pedirAcaoDeStatus,
    onEditAppointmentClick: openEditAppointmentModal,
    onDeleteAppointmentClick: openDeleteAppointmentModal,
    setToastMessage,
    setErrorMessage,
  }), [handleGridClick, onDeleteBloqueio, onReassignAppointment, handleMoveAppointment, pedirAcaoDeStatus, openEditAppointmentModal, openDeleteAppointmentModal, setToastMessage, setErrorMessage]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col lg:flex-row gap-6">
      
      {/* Calendário Lateral (Esquerda) */}
      <div className="w-full lg:w-80 bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm h-fit shrink-0">
        <div className="flex justify-between items-center mb-6">
           <button onClick={handlePrevMonth} className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"><span className="material-symbols-outlined text-[18px]">chevron_left</span></button>
           <h3 className="text-sm font-bold text-primary uppercase tracking-widest">{monthNames[month]} {year}</h3>
           <button onClick={handleNextMonth} className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"><span className="material-symbols-outlined text-[18px]">chevron_right</span></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
           {dayNames.map(day => <span key={day} className="text-[11px] font-bold text-on-surface-variant uppercase">{day}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
           {calendarDays.map((d, i) => {
             if (!d) return <div key={`empty-${i}`} className="h-8"></div>;
             const dStr = formatDayString(d);
             const isSelected = receptionDate === dStr;
             const isToday = dStr === todayStr;
             const coverage = getDayCoverage(dStr);
             
             let heatClass = 'bg-surface-container-lowest text-on-surface hover:bg-surface-container';
             if (coverage.availableCount < coverage.ideal) {
               heatClass = 'bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-200';
             } else if (coverage.availableCount >= coverage.ideal) {
               heatClass = 'bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200';
             }
             
             if (isSelected) {
               heatClass = 'bg-primary text-on-primary shadow-md ring-2 ring-primary/30 ring-offset-2 ring-offset-surface-container-lowest font-bold';
             } else if (isToday) {
               heatClass = 'border-2 border-primary text-primary hover:bg-primary/10 font-bold';
             }

             return (
               <div key={`day-${d}`} className="relative group flex items-center justify-center">
                 <button 
                   onClick={() => setReceptionDate(dStr)}
                   className={`h-8 w-8 rounded-full text-xs transition-all flex items-center justify-center ${heatClass}`}
                 >
                   {d}
                 </button>
                 
                 {/* Tooltip Hover nativo CSS */}
                 <div className="absolute z-50 bottom-full mb-2 hidden group-hover:flex flex-col w-64 p-3 bg-surface-container-highest shadow-2xl rounded-2xl text-sm border border-outline-variant pointer-events-none left-1/2 -translate-x-1/2">
                    <div className="font-bold text-primary mb-2 flex justify-between items-center border-b border-outline-variant/30 pb-1">
                      <span>Cobertura: {formatarDataBR(dStr)}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] ${coverage.availableCount < coverage.ideal ? 'bg-orange-500/20 text-orange-600' : 'bg-emerald-500/20 text-emerald-600'}`}>
                        {coverage.availableCount} {coverage.availableCount === 1 ? 'Plantão' : 'Plantões'}
                      </span>
                    </div>
                    <div className="text-xs text-on-surface mb-2 text-left">
                      <span className="font-bold text-emerald-600 mb-0.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Trabalhando:</span>
                      <span className="opacity-80 block pl-2.5 leading-tight">{coverage.trabalhando.length > 0 ? coverage.trabalhando.join(', ') : 'Nenhum'}</span>
                    </div>
                    <div className="text-xs text-on-surface-variant text-left">
                      <span className="font-bold text-orange-500 mb-0.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span> Folgas/Ausentes:</span>
                      <span className="opacity-80 block pl-2.5 leading-tight">{coverage.folgas.length > 0 ? coverage.folgas.join(' • ') : 'Nenhum'}</span>
                    </div>
                    <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 border-8 border-transparent border-t-surface-container-highest"></div>
                 </div>
               </div>
             );
           })}
        </div>
        {/* Legenda discreta das cores do mini calendário */}
        <div className="mt-4 pt-3 border-t border-outline-variant/15 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-on-surface-variant" aria-label="Legenda do calendário">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-200 border border-emerald-400" />
            Cobertura ok
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-200 border border-orange-400" />
            Reduzida
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-primary" />
            Hoje
          </span>
        </div>

        {/* Card compacto somente leitura com quem está de folga no dia (oculto quando ninguém está de folga) */}
        {(() => {
          const folgasHoje = employees
            .filter((emp) => atendeNaAgenda(emp) && estaDeFolga(dayStatusByEmployee.get(emp.id)))
            .map((emp) => ({
              id: emp.id,
              nome: emp.name,
              status: dayStatusByEmployee.get(emp.id)!,
            }));
          if (folgasHoje.length === 0) return null;
          return (
            <div className="mt-4 rounded-2xl border border-outline-variant/20 bg-surface-container-low p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">De folga no dia</p>
                <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">{folgasHoje.length}</span>
              </div>
              <ul className="space-y-1">
                {folgasHoje.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-on-surface truncate">{item.nome}</span>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-error bg-error/10 px-2 py-0.5 rounded-full">{item.status.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}
      </div>

      {/* Painel Central (Grade Visual) */}
      <div className="flex-1 bg-surface-container-lowest p-6 lg:p-8 rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden flex flex-col">
        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-2xl font-headline text-primary">Agenda da Recepção</h3>
            <p className="text-sm text-on-surface-variant">
              {visao === 'dia' ? `Controle do dia ${formatarDataBR(receptionDate)}` : visao === 'semana' ? 'Visão da semana' : 'Visão do mês'}
            </p>
          </div>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto max-w-full shrink-0">
            <button onClick={() => openBookingModal('', '')} className="px-3.5 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-bold uppercase tracking-wider shadow-md hover:bg-primary-dim transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0">
              <span className="material-symbols-outlined text-[17px]">add</span> Nova Reserva
            </button>
            {ehRecepcao && onOpenUpcomingAppointments && (
              <button onClick={() => onOpenUpcomingAppointments()} className="px-3.5 py-2.5 border border-primary/40 text-primary rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-primary/10 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <span className="material-symbols-outlined text-[17px]">event_note</span> Lista de Hoje
              </button>
            )}
            {semBaixa.length > 0 && (
              <button
                onClick={() => setMostrarSemBaixa((v) => !v)}
                aria-expanded={mostrarSemBaixa}
                aria-controls="lista-sem-baixa"
                title="Total acumulado de atendimentos passados sem baixa"
                className="px-3.5 py-2.5 border border-error/40 text-error rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-error/10 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <span className="material-symbols-outlined text-[17px]" aria-hidden="true">pending_actions</span> Sem baixa ({semBaixa.length})
              </button>
            )}
            {onAddBloqueio && !ehRecepcao && (
              <button onClick={() => openBlockModal('', '')} className="px-3.5 py-2.5 bg-error/15 text-error rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-error/25 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0">
                <span className="material-symbols-outlined text-[17px]">block</span> Bloqueio
              </button>
            )}
          </div>
        </div>

        {mostrarSemBaixa && semBaixa.length > 0 && <ListaSemBaixa itens={semBaixa} employees={employees} onAbrir={abrirAtendimento} />}

        <div className="flex flex-col md:flex-row gap-3 mb-6 shrink-0">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">search</span>
            <input type="text" placeholder="Buscar cliente, serviço ou código (AG-...)" aria-label="Buscar cliente, serviço ou código da reserva" value={scheduleSearchTerm} onChange={e => setScheduleSearchTerm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') abrirPorCodigo(); }} className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface" />
          </div>
          <select
            value={professionalFilter}
            onChange={(event) => setProfessionalFilter(event.target.value)}
            className="md:w-56 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl px-3 py-2 focus:ring-1 focus:ring-primary text-on-surface"
          >
            <option value="all">Profissional: Todos</option>
            <option value={OFF_DAY_FILTER}>Profissional: Somente de folga</option>
            {employees.filter((employee) => atendeNaAgenda(employee)).map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4 shrink-0">
          <div className="inline-flex rounded-xl bg-surface-container-low p-1 border border-outline-variant/20" role="group" aria-label="Visão da agenda">
            {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={visao === valor}
                onClick={() => setVisao(valor)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${visao === valor ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-primary'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {/* Semana e mês têm legenda própria (AgendaVisaoPeriodo): esta é a da grade do dia */}
          {visao === 'dia' && <LegendaEstadosAgenda />}
        </div>
        {visao !== 'dia' && professionalFilter === OFF_DAY_FILTER && (
          <p className="text-[11px] text-on-surface-variant mb-2 shrink-0">"Somente de folga" vale só na visão Dia: aqui aparecem os atendimentos de todos.</p>
        )}
        {visao === 'dia' && professionalFilter === OFF_DAY_FILTER && activeEmployees.length === 0 && (
          <p role="status" className="text-sm text-on-surface-variant mb-2 shrink-0">Nenhum profissional de folga neste dia.</p>
        )}
        {visao === 'dia' && !abreNaData(funcionamento, receptionDate) && (
          <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 mb-2 shrink-0">
            {mensagemCasaFechada(funcionamento, receptionDate)} Novos agendamentos não são aceitos.
          </p>
        )}
        {visao === 'dia' && (
          <p className="text-[11px] text-on-surface-variant mb-2 shrink-0">
            {/* Arrastar não funciona no toque: o caminho alternativo vale para tablet e teclado */}
            <span className="[@media(hover:none)]:hidden">Arraste um atendimento para outro horário ou profissional, ou use </span>
            <span className="hidden [@media(hover:none)]:inline">Use </span>
            o botão Editar do atendimento para remarcar.
          </p>
        )}

        {isOutsideLoadedWindow && (
          <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            A agenda carrega só o último ano. Para atendimentos mais antigos, abra o histórico do cliente.
          </p>
        )}
        {visao !== 'dia' ? (
          <AgendaVisaoPeriodo
            visao={visao}
            dataBase={receptionDate}
            todayStr={todayStr}
            appointments={periodAppointments}
            employees={employees}
            services={services}
            onMudarDataBase={setReceptionDate}
            onAbrirDia={(dia) => { setReceptionDate(dia); setVisao('dia'); }}
            onAbrirAtendimento={openEditAppointmentModal}
          />
        ) : (
        <div className="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden flex flex-col relative shadow-sm h-full group">
          <button onClick={() => scrollHorizontally('left')} className="absolute left-2 top-1/2 -translate-y-1/2 z-30 w-10 h-10 bg-surface shadow-md rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-container border border-outline-variant/20 text-on-surface"><span className="material-symbols-outlined">chevron_left</span></button>
          <button onClick={() => scrollHorizontally('right')} className="absolute right-2 top-1/2 -translate-y-1/2 z-30 w-10 h-10 bg-surface shadow-md rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-container border border-outline-variant/20 text-on-surface"><span className="material-symbols-outlined">chevron_right</span></button>
          <button onClick={scrollToCurrentTime} className="absolute bottom-4 right-4 z-30 bg-primary-container text-on-primary-container px-4 py-2 rounded-full shadow-md font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-primary/20 transition-all opacity-0 group-hover:opacity-100"><span className="material-symbols-outlined text-[16px]">my_location</span> Agora</button>

          {/* Cabeçalho Fixo */}
          <div className="flex border-b border-outline-variant/20 bg-surface-container-lowest/95 backdrop-blur z-20">
            <div className="w-14 shrink-0 border-r border-outline-variant/10"></div>
            <div className="flex flex-1 overflow-x-hidden" ref={headerScrollRef}>
              {activeEmployees.map(emp => (
                <div key={emp.id} className="flex-1 min-w-55 p-2 text-center border-r border-outline-variant/10">
                  <img src={emp.avatar} alt={emp.name} className="w-9 h-9 mx-auto rounded-full border-2 border-surface-container shadow-sm object-cover" />
                  <h4 className="font-bold text-on-surface text-xs mt-1 truncate">{emp.name.split(' ')[0]}</h4>
                  <p className="text-[10px] text-on-surface-variant uppercase tracking-widest truncate">{emp.specialty}</p>
                        {(() => {
                          const dayStatus = dayStatusByEmployee.get(emp.id);
                          if (!dayStatus) return null;
                          return (
                            <div className="mt-1 flex flex-col items-center gap-0.5">
                              <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${dayStatus.isAllDayUnavailable ? 'bg-error/10 text-error border-error/20' : 'bg-amber-500/10 text-amber-400 border-amber-400/30'}`}>
                                {dayStatus.label}
                              </span>
                              <p className="text-[10px] text-on-surface-variant uppercase tracking-widest truncate max-w-full">{dayStatus.reason}</p>
                            </div>
                          );
                        })()}
                </div>
              ))}
            </div>
          </div>

          {/* Área Deslizante da Timeline */}
          <div className="flex flex-1 overflow-y-auto overflow-x-auto relative custom-scrollbar" ref={bodyScrollRef} onScroll={(e) => { if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
            <div className="relative min-w-full w-max shrink-0 flex">
              <ScheduleRulerGrid
                startHour={horaInicioGrade}
                endHour={horaFimGrade}
                hourHeight={HOUR_HEIGHT}
                hourColumnClassName="w-14 shrink-0 bg-surface-container-lowest/95 backdrop-blur border-r border-outline-variant/20 sticky left-0 z-20 flex flex-col"
                labelClassName="absolute top-1 right-2 text-[11px] font-bold text-on-surface-variant bg-surface-container-lowest px-1 leading-none"
              />

              <ScheduleGridProvider schedule={scheduleGridContext} actions={scheduleGridActions}>
                <div
                  className="relative flex flex-1 min-w-max"
                >
                  {activeEmployees.map(emp => (
                    <EmployeeScheduleColumn key={emp.id} emp={emp} appointments={dayAppointmentsByEmployee.get(emp.id) ?? NO_APPOINTMENTS} />
                  ))}
                </div>
              </ScheduleGridProvider>

              {isTodayView && currentMinuteTop >= 0 && currentMinuteTop <= timelineHeight && (
                <div className={CURRENT_TIME_LINE.CONTAINER_CLASS} style={{ top: currentMinuteTop }}>
                  <div className={CURRENT_TIME_LINE.DOT_CLASS}></div>
                  <div className={CURRENT_TIME_LINE.BAR_CLASS}></div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>

      {/* Injeção dos Modais Refatorados */}
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
      {showNewBlockModal && (
        <BlockModal
          receptionDate={receptionDate} initialTime={initialBookTime} initialEmpId={initialBookEmp} employees={employees} appointments={appointments}
          onClose={closeBlockModal} onAddBloqueio={onAddBloqueio} onReassignAppointment={onReassignAppointment} setErrorMessage={setErrorMessage} setToastMessage={setToastMessage}
        />
      )}
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
      <ConfirmDialog
        open={Boolean(acaoPendente)}
        icon={acaoPendente?.acao === 'concluir' ? 'task_alt' : acaoPendente?.acao === 'falta' ? 'person_off' : 'undo'}
        tone={acaoPendente?.acao === 'falta' ? 'danger' : 'primary'}
        title={textoAcao.titulo}
        description={textoAcao.descricao}
        confirmLabel={textoAcao.botao}
        confirmingLabel="Salvando..."
        cancelLabel="Voltar"
        isSubmitting={aplicandoAcao}
        onConfirm={confirmarAcaoDeStatus}
        onClose={() => { if (!aplicandoAcao) setAcaoPendente(null); }}
      />
      <ConfirmDialog
        open={Boolean(movimentoPendente)}
        icon="event_repeat"
        tone="primary"
        title="Remarcar atendimento?"
        description={descricaoMovimento}
        confirmLabel="Remarcar"
        confirmingLabel="Remarcando..."
        // "Cancelar" ao lado de um atendimento poderia ser lido como cancelar o agendamento
        cancelLabel="Manter horário"
        isSubmitting={movendo}
        onConfirm={confirmarMovimento}
        onClose={cancelarMovimento}
      />
      {appointmentToDelete && (
        <DeleteAppointmentModal
          key={appointmentToDelete}
          appointmentId={appointmentToDelete} version={appointments.find((a) => a.id === appointmentToDelete)?.version} onClose={closeDeleteAppointmentModal} onDeleteAppointment={onDeleteAppointment} setToastMessage={setToastMessage} setErrorMessage={setErrorMessage} modo={ehRecepcao ? 'cancelar' : 'excluir'}
        />
      )}
    </motion.div>
  );
}