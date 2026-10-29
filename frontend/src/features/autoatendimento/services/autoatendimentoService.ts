import { getApiUrl } from '../../../config/api';
import {
  Service,
  AutoatendimentoDisponibilidadeResponse,
  AutoatendimentoReservaSession,
  AutoatendimentoConfig,
  ConfiguracaoEmpresa,
  Voucher,
} from '../../../types';

const getBaseUrl = () => `${getApiUrl()}/autoatendimento`;

const MENSAGEM_SEM_CONEXAO = 'Sem conexão com o servidor no momento. Verifique a internet do totem ou peça ajuda na recepção.';

// fetch do totem: falha de rede vira mensagem em português (nunca "Failed to fetch" na tela do cliente)
const fetchTotem = async (url: string, init?: RequestInit, mensagemSemConexao = MENSAGEM_SEM_CONEXAO) => {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(mensagemSemConexao);
  }
};

export async function fetchAutoatendimentoEmpresa(): Promise<ConfiguracaoEmpresa> {
  const res = await fetchTotem(`${getBaseUrl()}/empresa`);
  if (!res.ok) {
    throw new Error('Falha ao carregar dados da empresa.');
  }
  return res.json();
}

export async function fetchAutoatendimentoConfig(): Promise<AutoatendimentoConfig> {
  const res = await fetchTotem(`${getBaseUrl()}/config`);
  if (!res.ok) {
    throw new Error('Falha ao carregar configurações de autoatendimento.');
  }
  return res.json();
}

export async function updateAutoatendimentoConfig(
  config: Partial<AutoatendimentoConfig>
): Promise<AutoatendimentoConfig> {
  const token = localStorage.getItem('spa_token');
  const res = await fetchTotem(`${getBaseUrl()}/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(config),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.erro || 'Falha ao salvar configurações de autoatendimento.');
  }
  return data;
}

export async function fetchAutoatendimentoServicos(): Promise<Service[]> {
  const res = await fetchTotem(`${getBaseUrl()}/servicos`);
  if (!res.ok) {
    throw new Error('Falha ao carregar catálogo de serviços.');
  }
  return res.json();
}

export async function fetchAutoatendimentoDisponibilidade(
  servicoIdsOrId: string | string[],
  data: string
): Promise<AutoatendimentoDisponibilidadeResponse> {
  const queryParam = Array.isArray(servicoIdsOrId)
    ? `servicoIds=${encodeURIComponent(servicoIdsOrId.join(','))}`
    : `servicoId=${encodeURIComponent(servicoIdsOrId)}`;

  const res = await fetchTotem(`${getBaseUrl()}/disponibilidade?${queryParam}&data=${encodeURIComponent(data)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.erro || 'Falha ao buscar horários disponíveis.');
  }
  return res.json();
}

export async function reservarSlotAutoatendimento(params: {
  servicoId?: string;
  servicoIds?: string[];
  data: string;
  horario: string;
  terapeutaId?: string;
  salaId?: string;
}): Promise<{
  sucesso: boolean;
  sessionToken: string;
  lockExpiresAt: number;
  tempoRestanteSegundos: number;
  detalhes: AutoatendimentoReservaSession;
}> {
  const payload = {
    ...params,
    servicoId: params.servicoId || (params.servicoIds && params.servicoIds[0]) || '',
    servicoIds: params.servicoIds || (params.servicoId ? [params.servicoId] : []),
  };

  const res = await fetchTotem(`${getBaseUrl()}/reservar-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.erro || 'Não foi possível reservar este horário.');
  }

  return data;
}

export async function consultarSessaoAutoatendimento(
  sessionToken: string
): Promise<AutoatendimentoReservaSession & { tempoRestanteSegundos: number; expirado: boolean }> {
  const res = await fetchTotem(`${getBaseUrl()}/sessao/${sessionToken}`);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.erro || 'Sessão expirada ou não encontrada.');
  }

  return data;
}

export async function confirmarPagamentoAutoatendimento(params: {
  sessionToken: string;
  cliente: {
    nome: string;
    telefone: string;
    cpf?: string;
    observacoesSaude?: string;
  };
  metodoPagamento: 'pix' | 'cartao' | 'presencial_no_local';
  tipoPagamento: 'sinal' | 'integral' | 'local';
}): Promise<{ sucesso: boolean; agendamentoId: string; voucher: Voucher }> {
  const res = await fetchTotem(`${getBaseUrl()}/confirmar-pagamento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }, 'A conexão caiu antes da confirmação chegar. Toque em confirmar de novo: se a reserva já tiver sido registrada, o comprovante aparece sem cobrar duas vezes.');

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.erro || 'Erro ao processar agendamento.');
  }

  return data;
}

export async function cancelarReservaAutoatendimento(sessionToken: string): Promise<void> {
  // keepalive: a requisição continua mesmo se a página estiver sendo fechada/recarregada
  await fetchTotem(`${getBaseUrl()}/cancelar-reserva`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken }),
    keepalive: true,
  }).catch(() => {});
}

