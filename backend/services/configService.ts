import { prisma } from '../db';

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
