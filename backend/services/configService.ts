import type { ConfiguracaoEmpresa } from '@prisma/client';
import { prisma } from '../db';
import { config as ambiente } from '../env';
import { criarGatewayHttp } from './gatewayPagamento';

// Configurações padrão criadas na primeira leitura (fonte única para API interna e totem)

export const EMPRESA_PADRAO = {
  id: 'default',
  nomeEmpresa: 'OmniGestão - Atendimentos & Agendamentos',
  segmento: 'geral',
  slogan: 'Gestão inteligente e experiência de excelência para seus clientes.',
  icone: 'storefront',
  termoAtendimento: 'Atendimento',
  termoProfissional: 'Profissional',
  termoEspaco: 'Sala / Espaço',
  termoServico: 'Serviço',
  telefoneContato: null,
  emailContato: null,
  endereco: null,
  corTemaPrimaria: '#0f766e',
};

export const AUTOATENDIMENTO_PADRAO = {
  id: 'default',
  ativo: true,
  exigirPagamento: true,
  percentualSinal: 40,
  tempoLockMinutos: 10,
  permitirCancelamento: true,
  tempoMinimoCancelamentoHoras: 4,
  instrucoesCheckin: 'Chegue com 10 minutos de antecedência para recepção e confirmação do seu atendimento.',
  mensagemBoasVindas: 'Bem-vindo ao nosso autoatendimento. Reserve seu horário com facilidade.',
};

export const getEmpresaConfig = () => prisma.configuracaoEmpresa.upsert({
  where: { id: 'default' },
  update: {},
  create: EMPRESA_PADRAO,
});

// Lista branca: só estes campos saem para quem não está logado (totem, TV, login) e no aviso em tempo real.
// Campo novo no schema fica de fora até ser incluído aqui (os textos do WhatsApp ficam em /whatsapp/mensagens, só admin)
const CAMPOS_EMPRESA_PUBLICOS = [
  'id', 'nomeEmpresa', 'segmento', 'slogan', 'icone', 'termoAtendimento', 'termoProfissional', 'termoEspaco', 'termoServico',
  'telefoneContato', 'emailContato', 'endereco', 'corTemaPrimaria', 'usarComissao', 'exigirAnamnese', 'exigenciaHabilidades', 'horaAbertura',
  'horaFechamento', 'horaLimiteAgendamento', 'diasFuncionamento', 'diasEspeciais', 'atualizadoEm',
] as const satisfies readonly (keyof ConfiguracaoEmpresa)[];

export type EmpresaPublica = Pick<ConfiguracaoEmpresa, (typeof CAMPOS_EMPRESA_PUBLICOS)[number]> & { whatsappAtivo: boolean };

export const empresaPublica = (empresa: ConfiguracaoEmpresa): EmpresaPublica => ({
  ...(Object.fromEntries(CAMPOS_EMPRESA_PUBLICOS.map((campo) => [campo, empresa[campo]])) as Pick<ConfiguracaoEmpresa, (typeof CAMPOS_EMPRESA_PUBLICOS)[number]>),
  // Confirmação da reserva pelo WhatsApp só sai com o provedor HTTP configurado (communicationService)
  whatsappAtivo: Boolean(ambiente.whatsappUrl),
});

export const getAutoatendimentoConfig = () => prisma.configuracaoAutoatendimento.upsert({
  where: { id: 'default' },
  update: {},
  create: AUTOATENDIMENTO_PADRAO,
});

// Integração com o banco: a cobrança (Pix "copia e cola" e, se houver, checkout de cartão) vem do adapter HTTP de
// gatewayPagamento.ts quando PAYMENT_GATEWAY_URL está definida. Sem ela, nada é cobrado online.
export type CobrancaGateway = { pixCopiaECola?: string; pixQrCode?: string; cartaoOnlineDisponivel?: boolean };
// Na sessão do totem: a cobrança do sinal fica nos campos acima e a do valor integral aqui
export type CobrancasDaReserva = CobrancaGateway & { pixCopiaEColaIntegral?: string; pixQrCodeIntegral?: string };
export type GatewayPagamento = {
  criarCobranca: (cobranca: { referencia: string; valor: number; descricao: string }) => Promise<CobrancaGateway>;
};
export const gatewayPagamento: GatewayPagamento | null = ambiente.pagamentoGatewayUrl
  ? criarGatewayHttp({ url: ambiente.pagamentoGatewayUrl, token: ambiente.pagamentoGatewayToken })
  : null;

// O pagamento online só vale com o gateway implementado E o segredo do webhook configurado (para receber as
// confirmações). Sem os dois, o botão "exigir pagamento" fica guardado, mas o totem confirma a reserva com
// pagamento na recepção, em vez de mostrar uma cobrança que ninguém vai aprovar e deixar a reserva expirar.
export const pagamentoOnlineDisponivel = () => Boolean(gatewayPagamento && ambiente.pagamentoWebhookSecret);

export const comDisponibilidadePagamento = <T extends { exigirPagamento: boolean }>(config: T) => ({
  ...config,
  pagamentoOnlineDisponivel: pagamentoOnlineDisponivel(),
});
