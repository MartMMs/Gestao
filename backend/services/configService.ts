import { prisma } from '../db';
import { config as ambiente } from '../env';

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

export const getAutoatendimentoConfig = () => prisma.configuracaoAutoatendimento.upsert({
  where: { id: 'default' },
  update: {},
  create: AUTOATENDIMENTO_PADRAO,
});

// Integração com o banco: quem conectar a API implementa a criação da cobrança aqui (gera o Pix "copia e cola" e,
// se houver, o checkout de cartão) e a registra em gatewayPagamento. Sem integração, nada é cobrado online.
export type CobrancaGateway = { pixCopiaECola?: string; pixQrCode?: string; cartaoOnlineDisponivel?: boolean };
export type GatewayPagamento = {
  criarCobranca: (reserva: { sessionToken: string; valor: number; descricao: string }) => Promise<CobrancaGateway>;
};
export const gatewayPagamento: GatewayPagamento | null = null;

// O pagamento online só vale com o gateway implementado E o segredo do webhook configurado (para receber as
// confirmações). Sem os dois, o botão "exigir pagamento" fica guardado, mas o totem confirma a reserva com
// pagamento na recepção, em vez de mostrar uma cobrança que ninguém vai aprovar e deixar a reserva expirar.
export const pagamentoOnlineDisponivel = () => Boolean(gatewayPagamento && ambiente.pagamentoWebhookSecret);

export const comDisponibilidadePagamento = <T extends { exigirPagamento: boolean }>(config: T) => ({
  ...config,
  pagamentoOnlineDisponivel: pagamentoOnlineDisponivel(),
});
