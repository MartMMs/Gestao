export type Role = 'collaborator' | 'supervisor' | 'admin' | 'receptionist';
export type TipoEscala = '6x1' | '5x1' | '5x2' | '12x36' | 'rotativo' | 'personalizado';
export type TurnoSwapStatus = 'pendente' | 'aprovada' | 'rejeitada';
export type ServiceEligibilityMode = 'livre' | 'cargo' | 'habilidade' | 'profissional';

export interface ConfiguracaoEmpresa {
  id: string;
  nomeEmpresa: string;
  segmento: 'geral' | 'beleza_barbearia' | 'clinica_saude' | 'spa_bemestar' | 'estudio_fitness' | string;
  slogan?: string;
  icone?: string;
  termoAtendimento?: string;
  termoProfissional?: string;
  termoEspaco?: string;
  termoServico?: string;
  telefoneContato?: string;
  emailContato?: string;
  endereco?: string;
  corTemaPrimaria?: string;
  atualizadoEm?: string;
}

export interface Bloqueio {
  id: string;
  data: string;
  horaInicio: string;
  horaFim: string;
  motivo: string;
  colaboradorId: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  specialty: string;
  cargo?: string;
  tipoEscala?: TipoEscala;
  folgasDomingoNoMes?: number;
  cargaHorariaSemanal?: number;
  habilidades?: string[];
  avatar: string;
  rating: number;
  completedServices: number;
  diasTrabalho?: string;
  bloqueios?: Bloqueio[];
}

// Alteração de um profissional; `password` redefine a senha de acesso
export type EmployeeUpdate = Partial<Employee> & { password?: string };

export interface Appointment {
  id: string;
  clientId?: string;
  clientName: string;
  contact: string;
  cpf?: string;
  services: string[];
  date: string;
  time: string;
  guests: number;
  specialNeeds: string[];
  observation?: string;
  assignedEmployeeId: string;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  // Versão do registro no servidor (detecta edição simultânea)
  version?: string;
}

export interface Service {
  id: string;
  nome: string;
  preco: number;
  duracao: number;
  icone?: string;
  descricao?: string;
  modoElegibilidade?: ServiceEligibilityMode;
  cargosPermitidos?: string[];
  habilidadesPermitidas?: string[];
  profissionaisPermitidos?: string[];
  categoria?: string;
  tempoHigienizacaoMin?: number;
  comissaoPercentual?: number;
}

export interface Client {
  id: string;
  nome: string;
  telefone: string;
  cpf?: string;
  observacao?: string;
  alergias?: string[];
  preferencias?: string[];
}

export interface TurnoSwapRequest {
  id: string;
  colaboradorId: string;
  colaboradorNome?: string;
  dataOriginal: string;
  dataSolicitada: string;
  motivo: string;
  status: TurnoSwapStatus;
  respostaObservacao?: string;
  respondidoPorId?: string;
  criadoEm: string;
  atualizadoEm: string;
}


export const AVAILABLE_SERVICES = [
  'Massagem Relaxante',
  'Massagem Terapêutica',
  'Limpeza de Pele',
  'Drenagem Linfática',
  'Sessão de Yoga',
  'Aromaterapia'
];

export const SERVICE_DURATIONS: Record<string, number> = {
  'Massagem Relaxante': 60,
  'Massagem Terapêutica': 90,
  'Limpeza de Pele': 45,
  'Drenagem Linfática': 60,
  'Sessão de Yoga': 60,
  'Aromaterapia': 30
};

export const SPECIAL_NEEDS_OPTIONS = [
  'Mobilidade Reduzida'
];

export interface AutoatendimentoSlot {
  horario: string;
  disponivel: boolean;
  terapeuta?: { id: string; nome: string; especialidade: string };
  sala?: { id: string; nome: string; numero: number | null };
  motivoIndisponibilidade?: string;
}

export interface AutoatendimentoDisponibilidadeResponse {
  data: string;
  servico: {
    id: string;
    nome: string;
    preco: number;
    duracao: number;
    tempoHigienizacaoMin: number;
  };
  servicos?: Array<{
    id: string;
    nome: string;
    preco: number;
    duracao: number;
    tempoHigienizacaoMin?: number;
  }>;
  duracaoTotalProdutos?: number;
  bufferHigienizacao?: number;
  duracaoTotalSlot?: number;
  valorTotal?: number;
  slots: AutoatendimentoSlot[];
}

export interface AutoatendimentoConfig {
  id: string;
  ativo: boolean;
  exigirPagamento: boolean;
  percentualSinal: number;
  tempoLockMinutos: number;
  permitirCancelamento: boolean;
  tempoMinimoCancelamentoHoras: number;
  instrucoesCheckin?: string;
  mensagemBoasVindas?: string;
  atualizadoEm?: string;
  /** Há gateway de pagamento conectado no servidor. Sem ele, exigirPagamento fica guardado mas não cobra online. */
  pagamentoOnlineDisponivel?: boolean;
}

export interface AutoatendimentoReservaSession {
  sessionToken: string;
  servicoId: string;
  servicoIds?: string[];
  servicosNomes?: string[];
  data: string;
  horario: string;
  terapeutaId: string;
  salaId: string;
  terapeutaNome: string;
  salaNome: string;
  servicoNome: string;
  duracao: number;
  bufferHigienizacao?: number;
  duracaoTotalSlot?: number;
  valorTotal: number;
  valorSinal: number;
  exigirPagamento?: boolean;
  percentualSinal?: number;
  instrucoesCheckin?: string;
  tempoLockMinutos?: number;
  lockExpiresAt: number;
  /** Código Pix "copia e cola" emitido pelo gateway do banco (ausente enquanto não houver integração) */
  pixCopiaECola?: string;
  /** O gateway aceita cartão (os dados vão direto para ele, nunca para este servidor) */
  cartaoOnlineDisponivel?: boolean;
}

export interface Voucher {
  reservaId: string;
  codigoConfirmacao: string;
  clienteNome: string;
  clienteTelefone: string;
  terapiaNome: string;
  duracaoMin: number;
  data: string;
  horario: string;
  terapeutaNome: string;
  salaNome: string;
  valorTotal: number;
  valorSinal: number;
  statusPagamento: string;
  politicaCancelamento: string;
  orientacoesCheckIn: string[];
}


