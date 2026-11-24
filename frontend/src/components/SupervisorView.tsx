import { formatarDataBR } from '@shared/datasBR';
import { HorarioFuncionamentoCard } from '../features/company/components/HorarioFuncionamentoCard';
import { valorDoAtendimento } from '../utils/valorAtendimento';
import React, { useEffect, useMemo, useState } from 'react';
import { NO_SCALE_OVERRIDES } from '../features/scale/components/SupervisorEscalaTab';
import { useToast } from '../hooks/useToast';
import { useModal } from '../hooks/useModal';
import { motion } from 'motion/react';
import { Appointment, Bloqueio, Client, Employee, Service, TurnoSwapRequest, TurnoSwapStatus, EmployeeUpdate } from '../types';
import { getLocalTodayString } from '../features/appointments/utils/appointmentCore';
import { SupervisorDashboardTab } from '../features/dashboard/components';
import { SupervisorClientesTab } from '../features/clients/components';
import { SupervisorEquipeTab } from '../features/team/components';
import { SupervisorEscalaTab } from '../features/scale/components';
import { ModuloRH, SupervisorPlanejamentoTab } from '../features/planning/components';
import { periodosDeAusencia } from '../features/planning/utils/ausencias';
import { usePlanejamentoEscala, type ScaleOverridePayload } from '../features/planning/hooks/usePlanejamentoEscala';
import { ServicosTab, type ServicePayload } from '../features/services/components';
import { AutoatendimentoAdminTab } from '../features/autoatendimento/components';
import { RelatorioFinanceiroTab } from '../features/reports/components';
import { type DiaEscala } from '../utils/escalaCalculator';
import { formatarReais } from '../utils/formatters';

type AppointmentCreatePayload = Omit<Appointment, 'id' | 'status'> & {
  cpf?: string;
  clientId?: string;
  clientObservation?: string;
};

type ScaleSwapPayload = {
  from: {
    colaboradorId: string;
    data: string;
    snapshot?: { tipo: DiaEscala['tipo']; turno?: string; descricao?: string };
  };
  to: {
    colaboradorId: string;
    data: string;
    snapshot?: { tipo: DiaEscala['tipo']; turno?: string; descricao?: string };
  };
};

type ScaleReplicatePayload = {
  colaboradorId: string;
  data: string;
  targetDates: string[];
  source?: { tipo: DiaEscala['tipo']; turno?: string; descricao?: string };
};

export interface SupervisorViewProps {
  employees: Employee[];
  // Todas as contas ativas (supervisão e recepção inclusas): só a aba Equipe usa; "employees" é quem atende
  todasAsContas: Employee[];
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  scaleOverrides?: ScaleOverridePayload[];
  onReassign: (appointmentId: string, newEmployeeId: string, version?: string) => Promise<unknown> | void;
  onAddEmployee: (employee: Omit<Employee, 'id' | 'rating' | 'completedServices'> & { password: string }) => Promise<boolean | string | void> | void;
  onDeleteEmployee: (id: string, reallocateToId?: string) => Promise<unknown> | void;
  onEditEmployee: (id: string, employee: EmployeeUpdate) => Promise<boolean | string | void> | void;
  onAddService: (service: ServicePayload) => Promise<boolean | string | void>;
  onEditService: (id: string, service: ServicePayload) => Promise<boolean | string | void>;
  onDeleteService: (id: string) => Promise<unknown> | void;
  onAddAppointment: (appointment: AppointmentCreatePayload) => Promise<boolean | void> | void;
  isAddingAppointment?: boolean;
  onDeleteAppointment: (id: string, version?: string) => Promise<boolean | void> | void;
  onEditAppointment: (id: string, appointment: Partial<Appointment>) => Promise<boolean | void> | void;
  onAlterarStatus: (appointment: Appointment, status: 'completed' | 'no_show' | 'scheduled') => Promise<unknown>;
  onEditClient?: (id: string, clientData: Partial<Client>) => Promise<boolean | void> | void;
  onDeleteClient?: (id: string) => Promise<boolean | void> | void;
  onAddBloqueio?: (b: Omit<Bloqueio, 'id'>) => Promise<boolean>;
  onDeleteBloqueio?: (id: string) => Promise<boolean>;
  turnoSwapRequests?: TurnoSwapRequest[];
  onUpdateTurnoSwapRequestStatus?: (id: string, status: Exclude<TurnoSwapStatus, 'pendente'>, respostaObservacao?: string) => Promise<boolean | void> | void;
  onOpenUpcomingAppointments?: () => void;
  onSaveScaleOverride?: (payload: ScaleOverridePayload) => Promise<boolean | void> | void;
  onSwapScaleDays?: (payload: ScaleSwapPayload) => Promise<boolean | void> | void;
  onReplicateScaleDays?: (payload: ScaleReplicatePayload) => Promise<boolean | void> | void;
}

export function SupervisorView({ employees, todasAsContas, appointments, services, clients, scaleOverrides = NO_SCALE_OVERRIDES, onReassign, onAddEmployee, onDeleteEmployee, onEditEmployee, onAddService, onEditService, onDeleteService, onAddAppointment, isAddingAppointment, onDeleteAppointment, onEditAppointment, onAlterarStatus, onEditClient, onDeleteClient, onAddBloqueio, onDeleteBloqueio, turnoSwapRequests = [], onUpdateTurnoSwapRequestStatus, onOpenUpcomingAppointments, onSaveScaleOverride, onSwapScaleDays, onReplicateScaleDays }: SupervisorViewProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'escala' | 'planejamento' | 'equipe' | 'servicos' | 'clientes' | 'autoatendimento' | 'relatorios'>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const saved = window.sessionStorage.getItem('supervisor-active-tab');
    if (saved === 'dashboard' || saved === 'escala' || saved === 'planejamento' || saved === 'equipe' || saved === 'servicos' || saved === 'clientes' || saved === 'autoatendimento' || saved === 'relatorios') {
      return saved;
    }
    return 'dashboard';
  });

  const [activeModule, setActiveModule] = useState<'operacional' | 'rh'>(() => {
    if (typeof window === 'undefined') return 'operacional';
    const saved = window.sessionStorage.getItem('supervisor-active-module');
    return saved === 'rh' ? 'rh' : 'operacional';
  });


  // Estado para controlar o Modal de Detalhes do Colaborador
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [viewingEmployeeTab, setViewingEmployeeTab] = useState<'dashboard' | 'jornada' | 'ocorrencias'>('dashboard');
  // Estado para controlar o Modal de Exclusão de Serviço

  // Estado para controlar o filtro do histórico no modal
  const [historyFilter, setHistoryFilter] = useState<'all' | '7days' | 'month'>('all');
  

  // Estado para controlar o Toast de sucesso
  const { toastMessage, setToastMessage } = useToast();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Esc fecha só o aviso de erro (o de cima da pilha), não o formulário por baixo
  useModal(!!errorMessage, () => setErrorMessage(null));

  // Estado e regras da Grade de Escalas
  const planejamento = usePlanejamentoEscala({
    employees: todasAsContas, // a escala inclui supervisores; o hook tira admin e recepção
    scaleOverrides,
    turnoSwapRequests,
    onEditEmployee,
    onUpdateTurnoSwapRequestStatus,
    onSaveScaleOverride,
    setToastMessage,
    setErrorMessage,
  });
  const {
    planningOverridesList,
    cltRealtimeAlerts,
    ajustesSalvos,
  } = planejamento;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('supervisor-active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('supervisor-active-module', activeModule);
  }, [activeModule]);

  const handleModuleChange = (module: 'operacional' | 'rh') => {
    setActiveModule(module);
    if (module === 'rh' && activeTab !== 'equipe' && activeTab !== 'planejamento') {
      setActiveTab('planejamento');
    } else if (module === 'operacional' && (activeTab === 'equipe' || activeTab === 'planejamento')) {
      setActiveTab('escala');
    }
  };


  // Lógica de filtro para o histórico do colaborador no Modal
  const filteredHistory = viewingEmployee ? appointments.filter(a => {
    if (a.assignedEmployeeId !== viewingEmployee.id) return false;
    if (historyFilter === 'all') return true;
    
    const appDate = new Date(`${a.date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (historyFilter === '7days') {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      return appDate >= sevenDaysAgo && appDate <= today;
    }
    
    if (historyFilter === 'month') {
      return appDate.getMonth() === today.getMonth() && appDate.getFullYear() === today.getFullYear();
    }
    
    return true;
  }).sort((a, b) => new Date(`${b.date}T${b.time}`).getTime() - new Date(`${a.date}T${a.time}`).getTime()) : [];

  const todayStr = getLocalTodayString();


  const { viewingEmployeeRevenue, viewingEmployeeNoShows, viewingEmployeeSemBaixa } = useMemo(() => {
    if (!viewingEmployee) return { viewingEmployeeRevenue: 0, viewingEmployeeNoShows: 0, viewingEmployeeSemBaixa: 0 };
    let revenue = 0;
    let noShows = 0;
    let semBaixa = 0;
    for (const app of appointments) {
      if (app.assignedEmployeeId !== viewingEmployee.id) continue;
      // Falta gravada e "sem baixa" ficam separados, como no relatório. Aqui "sem baixa" é pelo dia (dias passados),
      // como na grade do dia; o relatório também conta os de hoje que já terminaram
      if (app.status === 'completed') revenue += valorDoAtendimento(app, services);
      else if (app.status === 'no_show') noShows += 1;
      else if (app.status === 'scheduled' && app.date < todayStr) semBaixa += 1;
    }
    return { viewingEmployeeRevenue: revenue, viewingEmployeeNoShows: noShows, viewingEmployeeSemBaixa: semBaixa };
  }, [viewingEmployee, appointments, services]);

  useModal(!!viewingEmployee, () => setViewingEmployee(null));

  return (
    <div className="w-full max-w-6xl">
      <div className="mb-6 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
                <h1 className="text-2xl md:text-3xl font-headline text-primary">
                  {activeModule === 'operacional' ? 'Portal do Supervisor' : 'Módulo de RH e Escalas'}
                </h1>
                <p className="text-sm text-on-surface-variant font-body">
                  {activeModule === 'operacional' 
                    ? (activeTab === 'escala' ? 'Agenda operacional da recepção em tempo real.' : 'Gestão operacional com foco em produtividade e qualidade.') 
                    : 'Gestão da equipe, escalas e jornadas contratuais.'}
                </p>
          </div>
              
              {/* Botão de Navegação entre Módulos (Simula a troca de página) */}
              {activeModule === 'operacional' ? (
                <button onClick={() => handleModuleChange('rh')} className="bg-primary-container text-on-primary-container px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-primary/20 transition-colors shadow-sm">
                  <span className="material-symbols-outlined text-[18px]">badge</span>
                  Acessar Módulo RH
                </button>
              ) : (
                <button onClick={() => handleModuleChange('operacional')} className="bg-surface-container-high text-on-surface px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-surface-container-highest transition-colors shadow-sm border border-outline-variant/20">
                  <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  Voltar para Operação
                </button>
              )}
        </div>

        <div className="flex bg-surface-container-low p-1 rounded-full border border-outline-variant/20 overflow-x-auto max-w-full w-full md:w-auto">
              {activeModule === 'operacional' ? (
                <>
                  <button onClick={() => setActiveTab('dashboard')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'dashboard' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Dashboard</button>
                  <button onClick={() => setActiveTab('escala')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'escala' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Agenda</button>
                  <button onClick={() => setActiveTab('servicos')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'servicos' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Serviços</button>
                  <button onClick={() => setActiveTab('clientes')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'clientes' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Clientes</button>
                  <button onClick={() => setActiveTab('relatorios')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'relatorios' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Relatórios</button>
                  <button onClick={() => setActiveTab('autoatendimento')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'autoatendimento' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Totem & Autoatendimento</button>
                </>
              ) : (
                <>
                  <button onClick={() => setActiveTab('planejamento')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'planejamento' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Grade de Escalas</button>
                  <button onClick={() => setActiveTab('equipe')} className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeTab === 'equipe' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}>Profissionais e Cargos</button>
                </>
              )}
        </div>
      </div>

      {activeTab === 'dashboard' && (
        <SupervisorDashboardTab
          appointments={appointments}
          services={services}
          employees={employees}
        />
      )}

      {activeTab === 'escala' && (
        <div className="space-y-8">
          <SupervisorEscalaTab
            papel="supervisor"
            employees={employees}
            appointments={appointments}
            services={services}
            clients={clients}
            scaleOverrides={planningOverridesList}
            onReassignAppointment={onReassign}
            onAddAppointment={onAddAppointment}
            isAddingAppointment={isAddingAppointment}
            onDeleteAppointment={onDeleteAppointment}
            onEditAppointment={onEditAppointment}
            onAlterarStatus={onAlterarStatus}
            onEditClient={onEditClient}
            onAddBloqueio={onAddBloqueio}
            onDeleteBloqueio={onDeleteBloqueio}
            setToastMessage={setToastMessage}
            setErrorMessage={setErrorMessage}
          />
        </div>
      )}

      {activeTab === 'planejamento' && (
        <ModuloRH
          planejamento={planejamento}
          onSaveScaleOverride={onSaveScaleOverride}
          onReplicateScaleDays={onReplicateScaleDays}
          onSwapScaleDays={onSwapScaleDays}
        >
          <SupervisorPlanejamentoTab
            {...planejamento}
            employees={planejamento.activeNonAdminEmployees}
            appointments={appointments}
            onSaveScaleOverride={onSaveScaleOverride}
            onSwapScaleDays={onSwapScaleDays}
            onReplicateScaleDays={onReplicateScaleDays}
          />
        </ModuloRH>
      )}

      {activeTab === 'equipe' && (
        <SupervisorEquipeTab
          employees={todasAsContas}
          onAddEmployee={onAddEmployee}
          onDeleteEmployee={onDeleteEmployee}
          onEditEmployee={onEditEmployee}
          onSaveScaleOverride={onSaveScaleOverride}
          setToastMessage={setToastMessage}
          setErrorMessage={setErrorMessage}
          onViewEmployee={(emp) => {
            setViewingEmployee(emp);
            setViewingEmployeeTab(emp.role === 'admin' ? 'ocorrencias' : 'dashboard');
          }}
        />
      )}

      {/* NOVA ABA: MENU DE SERVIÇOS (Inspirada no HTML enviado) */}
      {activeTab === 'servicos' && (
        <ServicosTab
          services={services}
          employees={employees}
          onAddService={onAddService}
          onEditService={onEditService}
          onDeleteService={onDeleteService}
          avisar={(msg, tipo) => (tipo === 'erro' ? setErrorMessage(msg) : setToastMessage(msg))}
        />
      )}

      {activeTab === 'clientes' && (
        <SupervisorClientesTab
          appointments={appointments}
          services={services}
          onEditClient={onEditClient}
          onDeleteClient={onDeleteClient}
          setToastMessage={setToastMessage}
        />
      )}

      {activeTab === 'autoatendimento' && (
        <div className="space-y-8">
          <HorarioFuncionamentoCard />
          <AutoatendimentoAdminTab />
        </div>
      )}

      {activeTab === 'relatorios' && <RelatorioFinanceiroTab />}

        {/* Modal de Detalhes e Histórico do Colaborador */}
        {viewingEmployee && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div 
              role="dialog" aria-modal="true" aria-label="Detalhes do colaborador"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-3xl w-full border border-outline-variant/20 max-h-[90vh] flex flex-col"
            >
              <div className="flex justify-between items-start mb-8 border-b border-outline-variant/20 pb-6">
                <div className="flex items-center gap-4">
                  <img src={viewingEmployee.avatar} alt={viewingEmployee.name} className="w-16 h-16 rounded-full object-cover border-2 border-primary/20" />
                  <div>
                    <h2 className="text-xl font-headline text-primary mb-1">{viewingEmployee.name}</h2>
                    <p className="text-xs text-on-surface-variant">{[viewingEmployee.specialty, viewingEmployee.usuario, viewingEmployee.email].filter(Boolean).join(' • ')}</p>
                  </div>
                </div>
                <button onClick={() => setViewingEmployee(null)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

          {viewingEmployee.role !== 'admin' && cltRealtimeAlerts.find(a => a.id === viewingEmployee.id) && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl mb-6 flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-500 mt-0.5">warning</span>
              <div>
                <h4 className="text-sm font-bold text-amber-600 uppercase tracking-widest">Alerta de Conformidade CLT</h4>
                <p className="text-xs text-amber-700/80 mt-1">{cltRealtimeAlerts.find(a => a.id === viewingEmployee.id)?.resumo.join(' | ')}</p>
              </div>
            </div>
          )}

          <div className="flex gap-6 mb-6 border-b border-outline-variant/20">
            {viewingEmployee.role !== 'admin' && (
              <>
                <button onClick={() => setViewingEmployeeTab('dashboard')} className={`pb-3 text-xs font-bold uppercase tracking-widest transition-colors ${viewingEmployeeTab === 'dashboard' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>Dashboard</button>
                <button onClick={() => setViewingEmployeeTab('jornada')} className={`pb-3 text-xs font-bold uppercase tracking-widest transition-colors ${viewingEmployeeTab === 'jornada' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>Regras de Jornada</button>
              </>
            )}
            <button onClick={() => setViewingEmployeeTab('ocorrencias')} className={`pb-3 text-xs font-bold uppercase tracking-widest transition-colors ${viewingEmployeeTab === 'ocorrencias' ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>Ocorrências (RH)</button>
          </div>

          {viewingEmployee.role !== 'admin' && viewingEmployeeTab === 'dashboard' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                 <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                   <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Serviços Concluídos</p>
                   <p className="text-2xl font-headline text-primary">{viewingEmployee.completedServices}</p>
                 </div>
                 <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                   <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Média de Avaliação</p>
                   <p className="text-sm text-on-surface-variant mt-2">Sem avaliações</p>
                 </div>
                 <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                   <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Faturamento</p>
                   <p className="text-2xl font-headline text-primary truncate" title={formatarReais(viewingEmployeeRevenue)}>
                     {formatarReais(viewingEmployeeRevenue)}
                   </p>
                 </div>
                 <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
                   <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Faltas</p>
                   <div className="flex items-center gap-1 text-2xl font-headline text-error">
                     {viewingEmployeeNoShows} <span className="material-symbols-outlined text-xl mb-0.5">event_busy</span>
                   </div>
                   {viewingEmployeeSemBaixa > 0 && (
                     <p className="text-[11px] text-on-surface-variant mt-1">+ {viewingEmployeeSemBaixa} sem baixa (dia passado, ninguém concluiu nem marcou falta)</p>
                   )}
                 </div>
              </div>

              <div className="flex justify-between items-end mb-4">
                <h3 className="text-lg font-headline text-primary">Histórico de Agendamentos</h3>
                <select 
                  value={historyFilter}
                  onChange={(e) => setHistoryFilter(e.target.value as 'all' | '7days' | 'month')}
                  className="bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer"
                >
                  <option value="all">Todo o período</option>
                  <option value="7days">Últimos 7 dias</option>
                  <option value="month">Este mês</option>
                </select>
              </div>
              
              <div className="overflow-y-auto grow border border-outline-variant/10 rounded-2xl">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-container-low sticky top-0 shadow-sm z-10">
                    <tr>
                      <th className="py-3 px-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Data/Hora</th>
                      <th className="py-3 px-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Cliente</th>
                      <th className="py-3 px-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Serviços</th>
                      <th className="py-3 px-4 text-[11px] font-bold text-on-surface-variant uppercase tracking-widest">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map(app => (
                        <tr key={app.id} className="border-t border-outline-variant/10 hover:bg-surface/50 transition-colors">
                          <td className="py-3 px-4 text-sm text-on-surface-variant whitespace-nowrap">
                            {formatarDataBR(app.date) || ''} <br/> <span className="font-bold">{app.time}</span>
                          </td>
                          <td className="py-3 px-4 text-sm text-on-surface font-medium">
                            {app.clientName}
                            {app.specialNeeds && app.specialNeeds.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1 cursor-help" title={app.observation ? `Observações: ${app.observation}` : 'Nenhuma observação detalhada.'}>
                                {app.specialNeeds.map((need: string) => (
                                  <span key={need} className="bg-error/10 text-error text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-widest flex items-center gap-0.5 w-fit">
                                    <span className="material-symbols-outlined text-[10px]">medical_services</span>
                                    {need}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs text-on-surface-variant max-w-37.5 truncate" title={app.services.join(', ')}>{app.services.join(', ')}</td>
                          <td className="py-3 px-4 text-xs">
                            <span className={`px-2 py-1 rounded-full font-bold uppercase tracking-wider text-[10px] ${app.status === 'completed' ? 'bg-primary/10 text-primary' : 'bg-secondary-container text-on-secondary-container'}`}>
                              {app.status === 'completed' ? 'Concluído' : 'Agendado'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {filteredHistory.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-on-surface-variant text-sm">Nenhum histórico encontrado para este período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {viewingEmployee.role !== 'admin' && viewingEmployeeTab === 'jornada' && (
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <h3 className="text-lg font-headline text-primary mb-4">Configuração Contratual</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10">
                  <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Padrão de Escala</p>
                  <p className="text-xl font-headline text-on-surface">{viewingEmployee.tipoEscala || '6x1'}</p>
                </div>
                <div className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10">
                  <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Folgas Dominicais (Mês)</p>
                  <p className="text-xl font-headline text-on-surface">{viewingEmployee.folgasDomingoNoMes ?? 2} domingos</p>
                </div>
                <div className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/10">
                  <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Carga Horária Base</p>
                  <p className="text-xl font-headline text-on-surface">{viewingEmployee.cargaHorariaSemanal ?? 40}h / semana</p>
                </div>
              </div>
            </div>
          )}

          {viewingEmployeeTab === 'ocorrencias' && (() => {
            // Bloqueios da agenda e férias/atestado/afastamento do Módulo RH (gravados na escala)
            const ausencias = periodosDeAusencia(ajustesSalvos.values(), new Map([[viewingEmployee.id, viewingEmployee.name]]));
            const total = (viewingEmployee.bloqueios?.length || 0) + ausencias.length;
            return (
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-headline text-primary">Histórico de Ocorrências</h3>
                <span className="text-xs text-on-surface-variant bg-surface-container px-3 py-1 rounded-full font-bold uppercase tracking-widest">{total} registros</span>
              </div>
              {total === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-outline-variant/20 rounded-2xl border-dashed">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">task_alt</span>
                  <p className="text-sm font-bold text-on-surface-variant">Dossiê Limpo</p>
                  <p className="text-xs text-on-surface-variant/70">Nenhuma falta, atestado ou férias registrados recentemente.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {ausencias.map((p) => (
                    <div key={`${p.motivo}:${p.inicio}`} className="flex items-center justify-between bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center bg-secondary-container text-secondary">
                          <span className="material-symbols-outlined" aria-hidden="true">beach_access</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{p.motivo}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">Registrado no Módulo RH</p>
                        </div>
                      </div>
                      <p className="text-xs font-bold uppercase tracking-widest text-on-surface text-right">
                        {formatarDataBR(p.inicio)}{p.fim !== p.inicio ? ` a ${formatarDataBR(p.fim)}` : ''}
                      </p>
                    </div>
                  ))}
                  {(viewingEmployee.bloqueios ?? []).map(bloq => (
                    <div key={bloq.id} className="flex items-center justify-between bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/20 shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bloq.motivo.toLowerCase().includes('falta') ? 'bg-error/10 text-error' : 'bg-secondary-container text-secondary'}`}>
                          <span className="material-symbols-outlined">{bloq.motivo.toLowerCase().includes('falta') ? 'person_off' : 'event_busy'}</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-on-surface">{bloq.motivo}</p>
                          <p className="text-xs text-on-surface-variant mt-0.5">{bloq.horaInicio} às {bloq.horaFim}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold uppercase tracking-widest text-on-surface">{formatarDataBR(bloq.data)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })()}
            </motion.div>
          </div>
        )}

        {/* Modal de Erro Elegante */}
        {errorMessage && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
            <motion.div 
              role="alertdialog" aria-modal="true" aria-labelledby="erro-supervisao-titulo" aria-describedby="erro-supervisao-texto"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-surface-container-lowest/90 backdrop-blur-2xl p-8 rounded-3xl shadow-2xl max-w-sm w-full border border-error/30 text-center"
            >
              <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl text-error" aria-hidden="true">error</span>
              </div>
              {/* Título neutro: este aviso serve a toda a supervisão (concluir, reabrir, cadastros), não só a reservas */}
              <h2 id="erro-supervisao-titulo" className="text-2xl font-headline text-error mb-2">Não foi possível</h2>
              <p id="erro-supervisao-texto" className="text-on-surface-variant text-sm mb-6">{errorMessage}</p>
              <button 
                autoFocus
                onClick={() => setErrorMessage(null)}
                className="w-full bg-surface-container hover:bg-surface-container-high text-on-surface py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-colors"
              >
                Entendi
              </button>
            </motion.div>
          </div>
        )}

        {/* Notificação Toast */}
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
