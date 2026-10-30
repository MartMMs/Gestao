import React, { Suspense, lazy, useEffect, useState, useCallback, useMemo } from 'react';
import { horarioParaMinutos } from '@shared/agenda';
import { flushSync } from 'react-dom';
import { Layout } from './components/Layout';
import { useQueryClient } from '@tanstack/react-query';
import { getBrazilCurrentMinuteOfDay, getLocalTodayString } from './features/appointments/utils/appointmentCore';
import { useAuth } from './AuthContext';
import { LoginView } from './components/LoginView';
import io from 'socket.io-client';
import { getSocketUrl } from './config/api';
import { aplicarAjusteEscala, gerarEscalaComRegras, type DiaEscala } from './utils/escalaCalculator';
import { analisarConformidadeCLT } from './utils/cltValidator';
import { AuditorModal } from './components/AuditorModal';
import { Employee, Appointment, Service, Client, Role, TurnoSwapRequest, TurnoSwapStatus, ServiceEligibilityMode, EmployeeUpdate } from './types'; // Tipos mais fortes
import {
  useAppointments, useAddAppointment, useCompleteAppointment,
  useCancelAppointment, useReassignAppointment, useEditAppointment, useDeleteAppointment,
  useEmployees, useAddEmployee, useDeleteEmployee, useEditEmployee,
  useServices, useAddService, useEditService, useDeleteService,
  useClients, useEditClient, useDeleteClient,
  useAddBloqueio, useDeleteBloqueio,
  useScaleOverrides,
  useTurnoSwapRequests, useAddTurnoSwapRequest, useUpdateTurnoSwapRequestStatus,
  useSaveScaleOverride, useSwapScaleDays, useReplicateScaleDays,
  useCompanyConfig,
  isApiError,
  type ScaleOverridePayload, type ScaleSwapPayload, type ScaleReplicatePayload,
} from './api'; // Importando os novos hooks

const AdminViewLazy = lazy(() => import('./components/AdminView').then((module) => ({ default: module.AdminView })));
import { isTeamMember } from './utils/formatters';
import { getAutoatendimentoUrl } from './config/hosts';
import { DEPENDENCIAS_ESCOPO, ESCOPOS_MUDANCA, ehEscopoMudanca } from '@shared/escopos';
const SupervisorViewLazy = lazy(() => import('./components/SupervisorView').then((module) => ({ default: module.SupervisorView })));
const CollaboratorViewLazy = lazy(() => import('./components/CollaboratorView').then((module) => ({ default: module.CollaboratorView })));
const TVPanelViewLazy = lazy(() => import('./components/TVPanelView').then((module) => ({ default: module.TVPanelView })));
const UpcomingAppointmentsModalLazy = lazy(() => import('./components/UpcomingAppointmentsModal').then((module) => ({ default: module.UpcomingAppointmentsModal })));
const AutoatendimentoViewLazy = lazy(() => import('./features/autoatendimento/components/AutoatendimentoView').then((module) => ({ default: module.AutoatendimentoView })));

const ModuleLoading = ({ label = 'Carregando módulo...' }: { label?: string }) => (
  <div className="min-h-60 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
    <span className="material-symbols-outlined text-4xl animate-spin text-primary">progress_activity</span>
    <p className="text-sm font-semibold uppercase tracking-wide">{label}</p>
  </div>
);

type ServicePayload = {
  nome: string;
  preco: number | string;
  duracao: number | string;
  icone?: string;
  descricao?: string;
  modoElegibilidade?: ServiceEligibilityMode;
  cargosPermitidos?: string[];
  habilidadesPermitidas?: string[];
  profissionaisPermitidos?: string[];
  categoria?: string;
  tempoHigienizacaoMin?: number | string;
  comissaoPercentual?: number | string;
};

const normalizeEligibilityMode = (value: unknown): ServiceEligibilityMode => {
  if (value === 'cargo' || value === 'habilidade' || value === 'profissional' || value === 'livre') return value;
  return 'livre';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)));
};

const normalizeServicePayload = (service: ServicePayload): { data?: Omit<Service, 'id'>; error?: string } => {
  const nome = service.nome?.trim();
  const preco = Number(service.preco);
  const duracao = Number(service.duracao);
  const icone = typeof service.icone === 'string' ? service.icone.trim() : undefined;
  const descricao = typeof service.descricao === 'string' ? service.descricao.trim() : undefined;
  const categoria = typeof service.categoria === 'string' ? service.categoria.trim() : undefined;
  const tempoHigienizacaoMin = Number(service.tempoHigienizacaoMin) || 0;
  const comissaoPercentual = service.comissaoPercentual !== undefined && service.comissaoPercentual !== '' && service.comissaoPercentual !== null ? Number(service.comissaoPercentual) : undefined;
  const modoElegibilidade = normalizeEligibilityMode(service.modoElegibilidade);
  const cargosPermitidos = modoElegibilidade === 'cargo'
    ? normalizeStringArray(service.cargosPermitidos)
    : [];
  const habilidadesPermitidas = modoElegibilidade === 'habilidade'
    ? normalizeStringArray(service.habilidadesPermitidas)
    : [];
  const profissionaisPermitidos = modoElegibilidade === 'profissional'
    ? normalizeStringArray(service.profissionaisPermitidos)
    : [];

  if (!nome || nome.length < 3) {
    return { error: 'O nome do serviço deve ter ao menos 3 caracteres.' };
  }

  if (nome.length > 80) {
    return { error: 'O nome do serviço deve ter no máximo 80 caracteres.' };
  }

  if (!Number.isFinite(preco) || preco < 0) {
    return { error: 'Informe um preço válido (maior ou igual a zero).' };
  }

  if (!Number.isInteger(duracao) || duracao < 5 || duracao > 480 || duracao % 5 !== 0) {
    return { error: 'A duração deve ser um número inteiro entre 5 e 480 minutos (múltiplos de 5).' };
  }

  if (icone && icone.length > 64) {
    return { error: 'O ícone informado é inválido.' };
  }

  if (descricao && descricao.length > 500) {
    return { error: 'A descrição deve ter no máximo 500 caracteres.' };
  }

  if (tempoHigienizacaoMin < 0 || !Number.isInteger(tempoHigienizacaoMin)) {
    return { error: 'O tempo de higienização deve ser um número inteiro (maior ou igual a zero).' };
  }

  if (comissaoPercentual !== undefined && (Number.isNaN(comissaoPercentual) || comissaoPercentual < 0 || comissaoPercentual > 100)) {
    return { error: 'A comissão deve ser um valor entre 0 e 100%.' };
  }

  if (modoElegibilidade === 'cargo' && cargosPermitidos.length === 0) {
    return { error: 'Selecione ao menos um cargo para serviços com restrição por cargo.' };
  }

  if (modoElegibilidade === 'habilidade' && habilidadesPermitidas.length === 0) {
    return { error: 'Selecione ao menos uma habilidade para serviços com restrição por habilidade.' };
  }

  if (modoElegibilidade === 'profissional' && profissionaisPermitidos.length === 0) {
    return { error: 'Selecione ao menos um profissional para serviços com restrição por profissional específico.' };
  }

  return {
    data: {
      nome,
      preco,
      duracao,
      icone: icone || 'spa',
      descricao: descricao || '',
      modoElegibilidade,
      cargosPermitidos,
      habilidadesPermitidas,
      profissionaisPermitidos,
      categoria: categoria || '',
      tempoHigienizacaoMin,
      comissaoPercentual,
    },
  };
};


export default function App() {
  const { currentUser, token, loginError, handleLogin, handleLogout } = useAuth();
  const queryClient = useQueryClient();
  const { data: companyConfig } = useCompanyConfig(token);
  const [activeRoleView, setActiveRoleView] = useState<Role | 'tv' | 'autoatendimento'>(() => currentUser?.role ?? 'collaborator');
  const [isPublicTVMode, setIsPublicTVMode] = useState(false);
  const [isPublicAutoatendimentoMode, setIsPublicAutoatendimentoMode] = useState(false);
  const shouldLoadSupervisorDatasets = Boolean(token) && (currentUser?.role === 'supervisor' || currentUser?.role === 'admin') && (activeRoleView === 'supervisor' || activeRoleView === 'admin');

  // 1. SUBSTITUIÇÃO DOS ESTADOS MANUAIS PELOS HOOKS DO REACT QUERY
  // Os dados, loading e erros agora são gerenciados automaticamente.
  const { data: employeesData, isLoading: loadingEmployees, isError: errorEmployees, error: employeesError } = useEmployees(token);
  const { data: appointmentsData, isLoading: loadingAppointments, isError: errorAppointments, error: appointmentsError } = useAppointments(token);
  const { data: services, isLoading: loadingServices, isError: errorServices, error: servicesError } = useServices(token);
  const { data: clients, isLoading: loadingClients, isError: errorClients, error: clientsError } = useClients(token);
  const { data: scaleOverridesData, isLoading: loadingScaleOverrides } = useScaleOverrides(token, undefined, { enabled: shouldLoadSupervisorDatasets });
  const { data: turnoSwapRequestsData, isLoading: loadingTurnoSwaps } = useTurnoSwapRequests(token, { enabled: shouldLoadSupervisorDatasets });

  const employees = useMemo(() => employeesData || [], [employeesData]);
  const appointments = useMemo(() => appointmentsData || [], [appointmentsData]);
  const scaleOverrides = useMemo(() => scaleOverridesData || [], [scaleOverridesData]);
  const turnoSwapRequests = useMemo(() => turnoSwapRequestsData || [], [turnoSwapRequestsData]);
  const upcomingAppointmentsCount = useMemo(() => {
    const today = getLocalTodayString();
    const currentMinuteOfDay = getBrazilCurrentMinuteOfDay();
    return appointments.filter((appointment) => {
      if (appointment.status !== 'scheduled' || appointment.date !== today) return false;
      const inicio = horarioParaMinutos(appointment.time);
      return !Number.isNaN(inicio) && inicio >= currentMinuteOfDay;
    }).length;
  }, [appointments]);

  const [showUpcomingAppointments, setShowUpcomingAppointments] = useState(false);
  const [showAuditorModal, setShowAuditorModal] = useState(false);

  const hasUnauthorizedBootstrapError = useMemo(() => {
    const bootstrapErrors = [employeesError, appointmentsError, servicesError, clientsError];
    return bootstrapErrors.some((error) => isApiError(error) && error.status === 401);
  }, [employeesError, appointmentsError, servicesError, clientsError]);

  // Atualiza a View de segurança baseada no cargo toda vez que o currentUser mudar
  useEffect(() => { if (currentUser) setActiveRoleView(currentUser.role); }, [currentUser]);

  // Estado do Tema (Modo Escuro/Claro) com persistência no navegador
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const savedTheme = localStorage.getItem('spa_theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Efeito apenas para a carga inicial (quando o site abre)
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []); // Executa apenas uma vez no carregamento

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    
    const updateDOM = () => {
      // Atualiza o estado do React (muda o ícone de Sol/Lua)
      flushSync(() => setIsDarkMode(newTheme));
      
      // Atualiza o HTML e o Cache IMEDIATAMENTE para a animação capturar certo
      if (newTheme) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('spa_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('spa_theme', 'light');
      }
    };

    if (!document.startViewTransition) {
      updateDOM();
    } else {
      document.startViewTransition(() => {
        updateDOM();
      });
    }
  };

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      console.error('[FRONTEND][UNCAUGHT_ERROR]', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('[FRONTEND][UNHANDLED_REJECTION]', {
        reason: event.reason,
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (!token || !hasUnauthorizedBootstrapError) return;

    console.warn('[FRONTEND][AUTH] Sessão expirada ou token invalido. Redirecionando para login.');
    queryClient.clear();
    handleLogout();
  }, [token, hasUnauthorizedBootstrapError, queryClient, handleLogout]);

  // ATIVA AS BUSCAS INICIAIS E O WEBSOCKET
  useEffect(() => {
    // Só conecta o socket e busca dados caso o usuário tenha um token (esteja logado)
    if (!token) return;

    const socket = io(getSocketUrl(), { auth: { token } });
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    // Evita tempestade de refetch: agrupa os avisos e recarrega só as listas que o servidor disse que mudaram.
    const pendentes = new Set<string>();
    socket.on('db_updated', (payload?: { escopos?: unknown[] }) => {
      // Sem escopo (ou só escopos desconhecidos) = recarrega tudo: na dúvida, nunca deixa a tela desatualizada
      const conhecidos = Array.isArray(payload?.escopos) ? payload.escopos.filter(ehEscopoMudanca) : [];
      (conhecidos.length > 0 ? conhecidos : ESCOPOS_MUDANCA).forEach((escopo) => {
        pendentes.add(escopo);
        DEPENDENCIAS_ESCOPO[escopo]?.forEach((dependente) => pendentes.add(dependente));
      });
      if (invalidateTimer) clearTimeout(invalidateTimer);
      invalidateTimer = setTimeout(() => {
        pendentes.forEach((escopo) => queryClient.invalidateQueries({ queryKey: [escopo], refetchType: 'active' }));
        pendentes.clear();
      }, 250);
    });

    return () => {
      if (invalidateTimer) clearTimeout(invalidateTimer);
      socket.disconnect();
    };
  }, [token, queryClient]);

  const staff = useMemo(() => {
    // Otimização de Performance O(N): Agrupa serviços concluídos primeiro
    const completedCounts = new Map<string, number>();
    for (const app of appointments) {
      if (app.status === 'completed') {
        completedCounts.set(app.assignedEmployeeId, (completedCounts.get(app.assignedEmployeeId) || 0) + 1);
      }
    }
    return employees.filter(e => isTeamMember(e)).map(emp => ({
      ...emp,
      completedServices: completedCounts.get(emp.id) || 0
    }));
  }, [employees, appointments]);

  // Calcula alertas CLT globais para o sino no header
  // Os alertas só dependem da equipe e da escala: não recalcula a cada agendamento novo (como "staff" faria)
  const teamMembers = useMemo(() => employees.filter((e) => isTeamMember(e)), [employees]);
  const cltRealtimeAlerts = useMemo(() => {
    if (currentUser?.role !== 'supervisor') return [];

    const monthRef = getLocalTodayString().slice(0, 7);
    const [yearRaw, monthRaw] = monthRef.split('-').map(Number);
    const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
    const month = Number.isFinite(monthRaw) ? monthRaw : new Date().getMonth() + 1;
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const overridesMap = new Map<string, { tipo: DiaEscala['tipo']; turno?: string; descricao?: string }>();
    scaleOverrides.forEach((override) => {
      overridesMap.set(`${override.colaboradorId}:${override.data}`, {
        tipo: override.tipo,
        turno: override.turno,
        descricao: override.descricao,
      });
    });

    const applyOverrideToDia = (employeeId: string, dia: DiaEscala): DiaEscala =>
      aplicarAjusteEscala(dia, overridesMap.get(`${employeeId}:${dia.data}`));

    return teamMembers
      .map((emp) => {
        const diasComRegras = gerarEscalaComRegras(
          {
            tipo: emp.tipoEscala || '6x1',
            dataInicio: firstDay,
          },
          daysInMonth,
          { folgasDomingoNoMes: emp.folgasDomingoNoMes ?? 2 },
        );

        const malha = diasComRegras.map((dia) => applyOverrideToDia(emp.id, dia));
        const analise = analisarConformidadeCLT(malha, { tipoEscala: emp.tipoEscala || '6x1' });

        return {
          id: emp.id,
          nome: emp.name,
          conforme: analise.statusGeral,
          resumo: analise.resumo,
        };
      })
      .filter((item) => !item.conforme);
  }, [teamMembers, scaleOverrides, currentUser]);

  // 2. SUBSTITUIÇÃO DAS FUNÇÕES DE CALLBACK PELAS MUTAÇÕES DO REACT QUERY
  // A lógica de 'fetch', 'try/catch', e 'setEstado' é abstraída para dentro dos hooks.
  // O componente apenas chama a função 'mutateAsync'. O 'onSuccess' nos hooks cuida da atualização da UI.
  const { mutateAsync: addAppointment, isPending: isAddingAppointment } = useAddAppointment(token);
  const { mutateAsync: completeAppointment } = useCompleteAppointment(token);
  const { mutateAsync: cancelAppointment } = useCancelAppointment(token);
  const { mutateAsync: reassignAppointment } = useReassignAppointment(token);
  const { mutateAsync: editAppointment } = useEditAppointment(token);
  const { mutateAsync: deleteAppointment } = useDeleteAppointment(token);
  const { mutateAsync: addEmployee } = useAddEmployee(token);
  const { mutateAsync: deleteEmployee } = useDeleteEmployee(token);
  const { mutateAsync: editEmployee } = useEditEmployee(token);
  const { mutateAsync: addService } = useAddService(token);
  const { mutateAsync: editService } = useEditService(token);
  const { mutateAsync: deleteService } = useDeleteService(token);
  const { mutateAsync: editClient } = useEditClient(token);
  const { mutateAsync: deleteClient } = useDeleteClient(token);
  const { mutateAsync: addBloqueio } = useAddBloqueio(token);
  const { mutateAsync: deleteBloqueio } = useDeleteBloqueio(token);
  const { mutateAsync: addTurnoSwapRequest } = useAddTurnoSwapRequest(token);
  const { mutateAsync: updateTurnoSwapRequestStatus } = useUpdateTurnoSwapRequestStatus(token);
  const { mutateAsync: saveScaleOverride } = useSaveScaleOverride(token);
  const { mutateAsync: swapScaleDays } = useSwapScaleDays(token);
  const { mutateAsync: replicateScaleDays } = useReplicateScaleDays(token);

  // Estável entre renders: a agenda repassa este callback às colunas memoizadas
  const handleReassign = useCallback((appointmentId: string, newEmployeeId: string) => {
    return reassignAppointment({ id: appointmentId, newEmployeeId });
  }, [reassignAppointment]);

  const handleDeleteEmployee = (id: string, reallocateToId?: string) => {
    return deleteEmployee({ id, reallocateToId });
  };

  const handleEditEmployee = (id: string, employee: EmployeeUpdate) => {
    return editEmployee({ id, ...employee });
  };

  const handleAddService = async (service: ServicePayload): Promise<boolean | string> => {
    const normalized = normalizeServicePayload(service);
    if (!normalized.data) {
      return normalized.error || 'Dados do serviço inválidos.';
    }

    try {
      await addService(normalized.data);
      return true;
    } catch (error) {
      return error instanceof Error ? error.message : 'Erro ao adicionar serviço.';
    }
  };

  const handleEditService = async (id: string, service: ServicePayload): Promise<boolean | string> => {
    const normalized = normalizeServicePayload(service);
    if (!normalized.data) {
      return normalized.error || 'Dados do serviço inválidos.';
    }

    try {
      await editService({
        id,
        ...normalized.data,
      });
      return true;
    } catch (error) {
      return error instanceof Error ? error.message : 'Erro ao atualizar serviço.';
    }
  };

  const handleEditAppointment = (id: string, appointment: Partial<Appointment>) => {
    return editAppointment({ id, ...appointment });
  };

  const handleEditClient = (id: string, clientData: Partial<Client>) => {
    return editClient({ id, ...clientData });
  };

  const handleAddTurnoSwapRequest = (payload: Omit<TurnoSwapRequest, 'id' | 'criadoEm' | 'atualizadoEm' | 'colaboradorNome'>) => {
    return addTurnoSwapRequest(payload);
  };

  const handleUpdateTurnoSwapRequestStatus = (id: string, status: Exclude<TurnoSwapStatus, 'pendente'>, respostaObservacao?: string) => {
    return updateTurnoSwapRequestStatus({ id, status, respostaObservacao });
  };

  const handleSaveScaleOverride = (payload: ScaleOverridePayload) => {
    return saveScaleOverride(payload);
  };

  const handleSwapScaleDays = (payload: ScaleSwapPayload) => {
    return swapScaleDays(payload);
  };

  const handleReplicateScaleDays = (payload: ScaleReplicatePayload) => {
    return replicateScaleDays(payload);
  };

  if (!currentUser && isPublicTVMode) {
    return (
      <Suspense fallback={<ModuleLoading label="Carregando painel TV..." />}>
        <TVPanelViewLazy appointments={appointments} employees={staff} onExit={() => setIsPublicTVMode(false)} />
      </Suspense>
    );
  }

  if (isPublicAutoatendimentoMode) {
    return (
      <Suspense fallback={<ModuleLoading label="Carregando Totem de Autoatendimento..." />}>
        <AutoatendimentoViewLazy onExitToPortal={() => setIsPublicAutoatendimentoMode(false)} />
      </Suspense>
    );
  }

  if (!currentUser) {
    return (
      <LoginView 
        onLogin={handleLogin} 
        onOpenTVPanel={() => setIsPublicTVMode(true)} 
        onOpenAutoatendimento={() => {
          // Em produção o totem vive no próprio subdomínio; sem URL configurada abre aqui mesmo
          const url = getAutoatendimentoUrl();
          if (url) window.location.assign(url);
          else setIsPublicAutoatendimentoMode(true);
        }}
        error={loginError} 
        companyName={companyConfig?.nomeEmpresa}
        companySlogan={companyConfig?.slogan}
        companyIcon={companyConfig?.icone}
      />
    );
  }

  // 3. ESTADOS GLOBAIS DE CARREGAMENTO E ERRO
  // Combina os status para garantir que a interface só renderize com tudo pronto
  const isGlobalLoading = loadingEmployees || loadingAppointments || loadingServices || loadingClients || (shouldLoadSupervisorDatasets && (loadingTurnoSwaps || loadingScaleOverrides));
  const criticalErrors = [errorEmployees, errorAppointments, errorServices, errorClients];
  const shouldBlockAppOnError = criticalErrors.every(Boolean);

  if (isGlobalLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface">
        <span className="material-symbols-outlined text-6xl text-primary animate-spin mb-4">
          progress_activity
        </span>
        <p className="text-xl font-serif text-on-surface animate-pulse">
          Carregando dados do sistema...
        </p>
      </div>
    );
  }

  if (hasUnauthorizedBootstrapError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-4">
        <div className="bg-surface-container p-8 rounded-3xl max-w-md text-center shadow-lg border border-outline-variant">
          <span className="material-symbols-outlined text-5xl text-primary mb-4">lock_clock</span>
          <h2 className="text-2xl font-bold text-on-surface mb-2">Sessão expirada</h2>
          <p className="text-on-surface-variant opacity-80">Estamos redirecionando para o login...</p>
        </div>
      </div>
    );
  }

  if (shouldBlockAppOnError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-4">
        <div className="bg-error-container p-8 rounded-3xl max-w-md text-center shadow-lg border border-error">
          <span className="material-symbols-outlined text-5xl text-on-error-container mb-4">cloud_off</span>
          <h2 className="text-2xl font-bold text-on-error-container mb-2">Falha na Conexão</h2>
          <p className="text-on-error-container opacity-80 mb-6">Não foi possível carregar as informações essenciais. Verifique sua conexão com o servidor.</p>
          <button onClick={() => window.location.reload()} className="bg-error text-on-error px-6 py-2 rounded-xl font-bold uppercase tracking-wider transition-colors hover:bg-error-dim">Tentar Novamente</button>
        </div>
      </div>
    );
  }

  // Se o Modo TV estiver ativo, renderiza ele em tela cheia (sem Layout de fundo)
  if (activeRoleView === 'tv') {
    return (
      <Suspense fallback={<ModuleLoading label="Carregando painel TV..." />}>
        <TVPanelViewLazy appointments={appointments} employees={staff} onExit={() => setActiveRoleView(currentUser.role)} />
      </Suspense>
    );
  }

  // Se a aba de Autoatendimento estiver ativa pelo Supervisor/Recepção
  if (activeRoleView === 'autoatendimento') {
    return (
      <Suspense fallback={<ModuleLoading label="Carregando Totem de Autoatendimento..." />}>
        <AutoatendimentoViewLazy onExitToPortal={() => setActiveRoleView(currentUser.role)} />
      </Suspense>
    );
  }

  return (
    <Layout 
      userName={currentUser.name} 
      userRole={currentUser.role} 
      activeView={activeRoleView} 
      companyName={companyConfig?.nomeEmpresa}
      companyIcon={companyConfig?.icone}
      onViewChange={(view) => {
        if (currentUser.role === 'admin' || currentUser.role === 'supervisor') setActiveRoleView(view);
      }} 
      onLogout={handleLogout}
      isDarkMode={isDarkMode}
      toggleTheme={toggleTheme}
      onOpenUpcomingAppointments={(currentUser.role === 'supervisor' || currentUser.role === 'admin') && (activeRoleView === 'supervisor' || activeRoleView === 'admin') ? () => setShowUpcomingAppointments(true) : undefined}
      upcomingAppointmentsCount={(currentUser.role === 'supervisor' || currentUser.role === 'admin') && (activeRoleView === 'supervisor' || activeRoleView === 'admin') ? upcomingAppointmentsCount : 0}
      cltAlertsCount={(currentUser.role === 'supervisor' || currentUser.role === 'admin') && (activeRoleView === 'supervisor' || activeRoleView === 'admin') ? cltRealtimeAlerts.length : 0}
      onOpenCltAlerts={() => setShowAuditorModal(true)}
    >
      <Suspense fallback={<ModuleLoading />}>
        {activeRoleView === 'admin' && (currentUser.role === 'admin' || currentUser.role === 'supervisor') ? (
          <AdminViewLazy
            employees={staff}
            appointments={appointments}
            services={services || []}
            clients={clients || []}
            onAddEmployee={addEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onEditEmployee={handleEditEmployee}
            onAddService={handleAddService}
            onEditService={handleEditService}
            onDeleteService={deleteService}
            onEditClient={handleEditClient}
            onDeleteClient={deleteClient}
            token={token}
          />
        ) : (activeRoleView === 'supervisor' && (currentUser.role === 'supervisor' || currentUser.role === 'admin')) ? (
          <SupervisorViewLazy 
            employees={staff}
            appointments={appointments}
            services={services || []}
            clients={clients || []}
            onReassign={handleReassign}
            onAddEmployee={addEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            onEditEmployee={handleEditEmployee}
            onAddService={handleAddService}
            onEditService={handleEditService}
            onDeleteService={deleteService}
            onAddAppointment={addAppointment}
            isAddingAppointment={isAddingAppointment}
            onDeleteAppointment={deleteAppointment}
            onEditAppointment={handleEditAppointment}
            onCompleteAppointment={completeAppointment}
            onEditClient={handleEditClient}
            onDeleteClient={deleteClient}
            onAddBloqueio={addBloqueio}
            onDeleteBloqueio={deleteBloqueio}
            scaleOverrides={scaleOverrides}
            turnoSwapRequests={turnoSwapRequests}
            onUpdateTurnoSwapRequestStatus={handleUpdateTurnoSwapRequestStatus}
            onOpenUpcomingAppointments={() => setShowUpcomingAppointments(true)}
            onSaveScaleOverride={handleSaveScaleOverride}
            onSwapScaleDays={handleSwapScaleDays}
            onReplicateScaleDays={handleReplicateScaleDays}
          />
        ) : (
          <CollaboratorViewLazy 
            currentUser={currentUser}
            employees={staff}
            appointments={appointments}
            services={services || []}
            clients={clients || []}
            onAddAppointment={addAppointment}
            isAddingAppointment={isAddingAppointment}
            onEditAppointment={handleEditAppointment}
            onDeleteAppointment={cancelAppointment}
            onEditClient={handleEditClient}
            onCompleteAppointment={completeAppointment}
            onAddBloqueio={addBloqueio}
            onDeleteBloqueio={deleteBloqueio}
            onSubmitTurnoSwapRequest={handleAddTurnoSwapRequest}
          />
        )}
      </Suspense>

      {showUpcomingAppointments && (
        <Suspense fallback={null}>
          <UpcomingAppointmentsModalLazy
            open={showUpcomingAppointments}
            appointments={appointments}
            employees={staff}
            services={services || []}
            onClose={() => setShowUpcomingAppointments(false)}
          />
        </Suspense>
      )}

      {showAuditorModal && (
        <AuditorModal
          open={showAuditorModal}
          alerts={cltRealtimeAlerts}
          onClose={() => setShowAuditorModal(false)}
          onResolve={(employeeId) => {
            setShowAuditorModal(false);
            window.dispatchEvent(new CustomEvent('quick-resolve-clt', { detail: { employeeId } }));
          }}
        />
      )}
    </Layout>
  );
}