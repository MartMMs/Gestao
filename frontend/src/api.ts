import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Appointment, Bloqueio, Client, Employee, EmployeeUpdate, Service, ServiceEligibilityMode, TurnoSwapRequest, TurnoSwapStatus, ConfiguracaoEmpresa } from './types';
import { getApiUrl } from './config/api';
import { redactSensitiveData } from '@shared/redact';

// Disparado quando a API recusa o token (sessão expirada); o AuthContext faz logout
export const SESSAO_EXPIRADA_EVENT = 'auth:sessao-expirada';

export class ApiError extends Error {
  status: number;
  requestId?: string | null;
  code?: string;

  constructor(message: string, status: number, requestId?: string | null, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.code = code;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const logFrontendApiError = (context: {
  endpoint: string;
  method: string;
  status?: number;
  requestId?: string | null;
  responseBody?: unknown;
  error?: unknown;
}) => {
  console.error('[FRONTEND][API_ERROR]', redactSensitiveData(context));
};

const fetchApi = async (url: string, token: string | null, options: RequestInit = {}) => {
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}${url}`, { ...options, headers });
  } catch (error) {
    logFrontendApiError({
      endpoint: url,
      method,
      error,
    });

    const fallbackMessage = error instanceof Error && error.message
      ? error.message
      : 'Falha de rede ao acessar o servidor';

    const networkMessage = /Failed to fetch|NetworkError|fetch/i.test(fallbackMessage)
    ? 'Servidor indisponível no momento. Verifique a API e tente novamente.'
      : fallbackMessage;

    throw new ApiError(networkMessage, 503, null, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id');
    const errorData = await response.json().catch(() => null);
    const message = errorData?.message || errorData?.erro || 'Erro na requisição com o servidor';
    const code = errorData?.code;

    logFrontendApiError({
      endpoint: url,
      method,
      status: response.status,
      requestId,
      responseBody: errorData,
    });

    if (response.status === 401 && token) {
      window.dispatchEvent(new CustomEvent(SESSAO_EXPIRADA_EVENT));
    }

    throw new ApiError(message, response.status, requestId, code);
  }

  return response.json();
};

interface BackendAppointment {
  id: string | number;
  data?: string;
  date?: string;
  time?: string;
  services?: string[];
  servicos?: Array<string | { nome?: string }>;
  cliente?: { id?: string | number; nome?: string; telefone?: string; cpf?: string };
  clientName?: string;
  contact?: string;
  cpf?: string;
  atualizadoEm?: string;
  guests?: number;
  specialNeeds?: string[];
  observation?: string;
  observacoesSaude?: string | null;
  assignedEmployeeId?: string;
  colaboradorId?: string;
  status?: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
}

interface BackendEmployee {
  id: string | number;
  name?: string;
  nome?: string;
  email?: string;
  role?: string;
  papel?: string;
  specialty?: string;
  especialidade?: string;
  avatar?: string;
  rating?: number;
  completedServices?: number;
  diasTrabalho?: string;
  cargo?: string;
  tipoEscala?: string;
  cargaHorariaSemanal?: number;
  folgasDomingoNoMes?: number;
  habilidades?: string[];
  bloqueios?: Employee['bloqueios'];
}

interface BackendService {
  id: string | number;
  nome?: string;
  preco?: number | string;
  duracao?: number | string | null;
  icone?: string | null;
  descricao?: string | null;
  modoElegibilidade?: string | null;
  cargosPermitidos?: string[] | null;
  habilidadesPermitidas?: string[] | null;
  profissionaisPermitidos?: string[] | null;
  categoria?: string | null;
  tempoHigienizacaoMin?: number | string | null;
  comissaoPercentual?: number | string | null;
}

interface BackendTurnoSwapRequest {
  id: string | number;
  colaboradorId: string;
  dataOriginal: string;
  dataSolicitada: string;
  motivo: string;
  status: TurnoSwapStatus;
  respostaObservacao?: string | null;
  respondidoPorId?: string | null;
  criadoEm: string | Date;
  atualizadoEm: string | Date;
  colaborador?: { nome?: string };
  colaboradorNome?: string;
}

const normalizeAppointment = (appointment: BackendAppointment): Appointment => {
  const dateFromBackend = appointment.data ? new Date(appointment.data) : null;
  const brazilDate = dateFromBackend
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(dateFromBackend)
    : '';
  const brazilTime = dateFromBackend
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(dateFromBackend)
    : '';

  const services = Array.isArray(appointment.services)
    ? appointment.services
    : Array.isArray(appointment.servicos)
      ? appointment.servicos.map((service) => typeof service === 'string' ? service : service.nome || '').filter(Boolean)
      : [];

  return {
    id: String(appointment.id),
    clientId: appointment.cliente?.id ? String(appointment.cliente.id) : undefined,
    clientName: appointment.clientName || appointment.cliente?.nome || '',
    contact: appointment.contact || appointment.cliente?.telefone || 'Não informado',
    cpf: appointment.cpf || appointment.cliente?.cpf || undefined,
    services,
    date: typeof appointment.date === 'string'
      ? appointment.date
      : brazilDate,
    time: appointment.time || brazilTime,
    guests: appointment.guests ?? 1,
    specialNeeds: appointment.specialNeeds ?? [],
    // O backend guarda as observações em observacoesSaude (protegidas pela regra da ficha de saúde)
    observation: appointment.observation ?? appointment.observacoesSaude ?? '',
    assignedEmployeeId: appointment.assignedEmployeeId || appointment.colaboradorId || '',
    status: appointment.status || 'scheduled',
    version: appointment.atualizadoEm,
  };
};

const normalizeEmployee = (employee: BackendEmployee): Employee => {
  const name = employee.name || employee.nome || 'Usuário';
  const specialty = employee.specialty || employee.especialidade || '';
  const role = employee.role || employee.papel || 'collaborator';

  return {
    id: String(employee.id),
    name,
    email: employee.email || '',
    role: role === 'admin' || role === 'supervisor' || role === 'receptionist' ? role : 'collaborator',
    specialty,
    avatar: employee.avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(name)}`,
    rating: Number(employee.rating) || 5,
    completedServices: Number(employee.completedServices) || 0,
    diasTrabalho: employee.diasTrabalho || '1,2,3,4,5,6',
    cargo: employee.cargo || undefined,
    tipoEscala: (employee.tipoEscala as Employee['tipoEscala']) || undefined,
    folgasDomingoNoMes: typeof employee.folgasDomingoNoMes === 'number' ? employee.folgasDomingoNoMes : undefined,
    cargaHorariaSemanal: typeof employee.cargaHorariaSemanal === 'number' ? employee.cargaHorariaSemanal : undefined,
    habilidades: Array.isArray(employee.habilidades) ? employee.habilidades : [],
    bloqueios: Array.isArray(employee.bloqueios) ? employee.bloqueios : [],
  };
};

const normalizeServiceEligibilityMode = (value: unknown): ServiceEligibilityMode => {
  if (value === 'cargo' || value === 'habilidade' || value === 'profissional' || value === 'livre') return value;
  return 'livre';
};

const normalizeService = (service: BackendService): Service => {
  const parsedPrice = Number(service.preco);
  const parsedDuration = Number(service.duracao);
  const parsedHigiene = Number(service.tempoHigienizacaoMin);
  const parsedComissao = service.comissaoPercentual === null || service.comissaoPercentual === undefined || service.comissaoPercentual === ''
    ? undefined
    : Number(service.comissaoPercentual);

  return {
    id: String(service.id),
    nome: typeof service.nome === 'string' ? service.nome : 'Serviço',
    preco: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0,
    duracao: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 60,
    icone: typeof service.icone === 'string' && service.icone.trim() ? service.icone : 'spa',
    descricao: typeof service.descricao === 'string' ? service.descricao : '',
    modoElegibilidade: normalizeServiceEligibilityMode(service.modoElegibilidade),
    cargosPermitidos: Array.isArray(service.cargosPermitidos) ? service.cargosPermitidos.filter((value): value is string => typeof value === 'string') : [],
    habilidadesPermitidas: Array.isArray(service.habilidadesPermitidas) ? service.habilidadesPermitidas.filter((value): value is string => typeof value === 'string') : [],
    profissionaisPermitidos: Array.isArray(service.profissionaisPermitidos) ? service.profissionaisPermitidos.filter((value): value is string => typeof value === 'string') : [],
    categoria: typeof service.categoria === 'string' ? service.categoria : '',
    tempoHigienizacaoMin: Number.isFinite(parsedHigiene) && parsedHigiene >= 0 ? parsedHigiene : 0,
    comissaoPercentual: Number.isFinite(parsedComissao) ? parsedComissao : undefined,
  };
};

const normalizeTurnoSwapRequest = (request: BackendTurnoSwapRequest): TurnoSwapRequest => ({
  id: String(request.id),
  colaboradorId: request.colaboradorId,
  colaboradorNome: request.colaboradorNome ?? request.colaborador?.nome,
  dataOriginal: request.dataOriginal,
  dataSolicitada: request.dataSolicitada,
  motivo: request.motivo,
  status: request.status,
  respostaObservacao: request.respostaObservacao || undefined,
  respondidoPorId: request.respondidoPorId || undefined,
  criadoEm: typeof request.criadoEm === 'string' ? request.criadoEm : request.criadoEm.toISOString(),
  atualizadoEm: typeof request.atualizadoEm === 'string' ? request.atualizadoEm : request.atualizadoEm.toISOString(),
});

// Tipos para os dados de mutação
type NewAppointmentPayload = Omit<Appointment, 'id' | 'status'>;
type EditAppointmentPayload = Partial<Appointment> & { id: string };
type NewEmployeePayload = Omit<Employee, 'id' | 'rating' | 'completedServices' | 'bloqueios' | 'avatar'> & { avatar?: string; password: string };
type EditEmployeePayload = EmployeeUpdate & { id: string };
type NewServicePayload = Omit<Service, 'id'>;
type NewBloqueioPayload = Omit<Bloqueio, 'id'> & { datas?: string[] };
type NewTurnoSwapPayload = Omit<TurnoSwapRequest, 'id' | 'criadoEm' | 'atualizadoEm' | 'colaboradorNome'>;
type QueryHookOptions = { enabled?: boolean };

export type ScaleDayType = 'trabalho' | 'folga' | 'fds';

export interface ScaleDaySnapshot {
  tipo: ScaleDayType;
  turno?: string;
  descricao?: string;
}

export interface ScaleOverridePayload {
  colaboradorId: string;
  data: string;
  tipo: ScaleDayType;
  turno?: string;
  descricao?: string;
}

export interface ScaleSwapPayload {
  from: { colaboradorId: string; data: string; snapshot?: ScaleDaySnapshot };
  to: { colaboradorId: string; data: string; snapshot?: ScaleDaySnapshot };
}

export interface ScaleReplicatePayload {
  colaboradorId: string;
  data: string;
  targetDates: string[];
  source?: ScaleDaySnapshot;
}

const normalizeScaleDayType = (value: unknown): ScaleDayType | null => {
  if (value === 'trabalho' || value === 'folga' || value === 'fds') return value;
  return null;
};

const normalizeScaleOverridePayload = (value: unknown): ScaleOverridePayload | null => {
  if (!value || typeof value !== 'object') return null;

  const row = value as Record<string, unknown>;
  const colaboradorId = typeof row.colaboradorId === 'string' ? row.colaboradorId : '';
  const data = typeof row.data === 'string' ? row.data : '';
  const tipo = normalizeScaleDayType(row.tipo);

  if (!colaboradorId || !data || !tipo) return null;

  const turno = tipo === 'trabalho' && typeof row.turno === 'string' ? row.turno : undefined;
  const descricao = typeof row.descricao === 'string' ? row.descricao : undefined;

  return {
    colaboradorId,
    data,
    tipo,
    turno,
    descricao,
  };
};

// =======================
// AGENDAMENTOS
// =======================
export const useAppointments = (token: string | null) => useQuery({
  queryKey: ['appointments'],
  queryFn: async () => {
    // O servidor devolve só o último ano: agendas não precisam do arquivo inteiro
    // (histórico de cliente usa useClientAppointments; relatórios, /agendamentos/relatorio/concluidos)
    const appointments = await fetchApi('/agendamentos', token);
    // O servidor já descarta cancelados e não comparecimentos; o filtro abaixo é só defesa
    return Array.isArray(appointments)
      ? appointments.map(normalizeAppointment).filter((a) => a.status === 'scheduled' || a.status === 'completed')
      : [];
  },
  enabled: !!token,
});

export const useAddAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewAppointmentPayload) => fetchApi('/agendamentos', token, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

export const useCompleteAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/agendamentos/${id}/concluir`, token, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

// Desmarca o atendimento mantendo o histórico (colaboradores não podem excluir)
export const useCancelAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/agendamentos/${id}/status`, token, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

export const useReassignAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newEmployeeId }: { id: string, newEmployeeId: string }) => 
      fetchApi(`/agendamentos/${id}/reassign`, token, { method: 'PATCH', body: JSON.stringify({ newEmployeeId }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

export const useEditAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EditAppointmentPayload) => fetchApi(`/agendamentos/${data.id}`, token, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

export const useDeleteAppointment = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/agendamentos/${id}`, token, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointments'] })
  });
};

// =======================
// COLABORADORES
// =======================
// Histórico completo de um cliente, buscado só quando o histórico é aberto.
// A chave começa com 'appointments' para ser invalidada junto com a agenda.
export const useClientAppointments = (token: string | null, clientId: string | null) => useQuery({
  queryKey: ['appointments', 'cliente', clientId],
  queryFn: async () => {
    const appointments = await fetchApi(`/agendamentos?clienteId=${encodeURIComponent(clientId || '')}`, token);
    return Array.isArray(appointments) ? appointments.map(normalizeAppointment) : [];
  },
  enabled: !!token && !!clientId,
});

export const useEmployees = (token: string | null) => useQuery({
  queryKey: ['employees'],
  queryFn: async () => {
    const employees = await fetchApi('/colaboradores', token);
    return Array.isArray(employees) ? employees.map(normalizeEmployee) : [];
  },
  enabled: !!token,
});

export const useAddEmployee = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewEmployeePayload) =>
      fetchApi('/colaboradores', token, {
        method: 'POST',
        body: JSON.stringify({
          nome: data.name,
          email: data.email,
          especialidade: data.specialty,
          cargo: data.cargo,
          tipoEscala: data.tipoEscala,
          folgasDomingoNoMes: data.folgasDomingoNoMes,
          cargaHorariaSemanal: data.cargaHorariaSemanal,
          habilidades: data.habilidades,
          papel: data.role,
          diasTrabalho: data.diasTrabalho,
          senha: data.password,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
};

export const useDeleteEmployee = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reallocateToId }: { id: string, reallocateToId?: string }) => 
      fetchApi(`/colaboradores/${id}`, token, { method: 'DELETE', body: JSON.stringify({ reallocateToId }) }),
    // Remover alguém pode transferir ou cancelar atendimentos futuros
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    }
  });
};

export const useEditEmployee = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: EditEmployeePayload) =>
      fetchApi(`/colaboradores/${data.id}`, token, {
        method: 'PUT',
        body: JSON.stringify({
          nome: data.name,
          email: data.email,
          especialidade: data.specialty,
          cargo: data.cargo,
          tipoEscala: data.tipoEscala,
          folgasDomingoNoMes: data.folgasDomingoNoMes,
          cargaHorariaSemanal: data.cargaHorariaSemanal,
          habilidades: data.habilidades,
          papel: data.role,
          diasTrabalho: data.diasTrabalho,
          senha: data.password,
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
};

// =======================
// TROCAS DE TURNO
// =======================
export const useTurnoSwapRequests = (token: string | null, options?: QueryHookOptions) => useQuery({
  queryKey: ['turno-swaps'],
  queryFn: async () => {
    try {
      const requests = await fetchApi('/trocas-turno', token);
      return Array.isArray(requests) ? requests.map(normalizeTurnoSwapRequest) : [];
    } catch (error) {
      // The swap module is optional in some deployments; 404 should not block app boot.
      if (isApiError(error) && error.status === 404) {
        return [];
      }
      throw error;
    }
  },
  enabled: !!token && (options?.enabled ?? true),
});

export const useAddTurnoSwapRequest = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewTurnoSwapPayload) =>
      fetchApi('/trocas-turno', token, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['turno-swaps'] }),
  });
};

export const useUpdateTurnoSwapRequestStatus = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, respostaObservacao }: { id: string; status: Exclude<TurnoSwapStatus, 'pendente'>; respostaObservacao?: string }) =>
      fetchApi(`/trocas-turno/${id}/status`, token, {
        method: 'PATCH',
        body: JSON.stringify({ status, respostaObservacao }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['turno-swaps'] }),
  });
};

// =======================
// PLANEJAMENTO DE ESCALA
// =======================
export const useScaleOverrides = (
  token: string | null,
  params?: { month?: string; colaboradorId?: string },
  options?: QueryHookOptions,
) => useQuery({
  queryKey: ['scale-overrides', params?.month || 'all', params?.colaboradorId || 'all'],
  queryFn: async () => {
    const search = new URLSearchParams();
    if (params?.month) search.set('month', params.month);
    if (params?.colaboradorId) search.set('colaboradorId', params.colaboradorId);
    const suffix = search.toString() ? `?${search.toString()}` : '';
    const result = await fetchApi(`/escala/overrides${suffix}`, token);
    if (!Array.isArray(result)) return [];

    return result
      .map((item) => normalizeScaleOverridePayload(item))
      .filter((item): item is ScaleOverridePayload => Boolean(item));
  },
  enabled: !!token && (options?.enabled ?? true),
});

export const useSaveScaleOverride = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ScaleOverridePayload) =>
      fetchApi('/escala/override', token, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['scale-overrides'] });
    },
  });
};

export const useSwapScaleDays = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ScaleSwapPayload) =>
      fetchApi('/escala/swap', token, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['scale-overrides'] });
    },
  });
};

export const useReplicateScaleDays = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ScaleReplicatePayload) =>
      fetchApi('/escala/replicate', token, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['scale-overrides'] });
    },
  });
};

// =======================
// SERVIÇOS
// =======================
export const useServices = (token: string | null) => useQuery({
  queryKey: ['services'],
  queryFn: async () => {
    const services = await fetchApi('/servicos', token);
    return Array.isArray(services) ? services.map(normalizeService) : [];
  },
  enabled: !!token,
});

export const useAddService = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewServicePayload) => fetchApi('/servicos', token, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] })
  });
};

export const useEditService = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Service) => fetchApi(`/servicos/${data.id}`, token, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] })
  });
};

export const useDeleteService = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/servicos/${id}`, token, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] })
  });
};

// =======================
// CLIENTES E BLOQUEIOS
// =======================
export const useClients = (token: string | null) => useQuery({
  queryKey: ['clients'],
  queryFn: () => fetchApi('/clientes', token),
  enabled: !!token,
});

export const useEditClient = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Client> & { id: string }) => fetchApi(`/clientes/${data.id}`, token, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] })
  });
};

export const useDeleteClient = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/clientes/${id}`, token, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] })
  });
};

export const useAddBloqueio = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NewBloqueioPayload) => fetchApi('/bloqueios', token, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }) // O bloqueio afeta o usuário, então atualizamos employees
  });
};

export const useDeleteBloqueio = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/bloqueios/${id}`, token, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] })
  });
};

export const useCompanyConfig = (token?: string | null) => useQuery<ConfiguracaoEmpresa>({
  queryKey: ['company-config'],
  queryFn: () => fetchApi('/empresa/config', token || null),
  staleTime: 1000 * 60 * 5,
});

export const useUpdateCompanyConfig = (token: string | null) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ConfiguracaoEmpresa>) =>
      fetchApi('/empresa/config', token, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-config'] });
    },
  });
};