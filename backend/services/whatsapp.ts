// Envio de mensagens por WhatsApp atrás de um provider: HTTP genérico (seu provedor ou um serviço intermediário)
// ou só registro no log, com telefone mascarado, quando WHATSAPP_WEBHOOK_URL não está definida. Puro (sem banco).
//   POST WHATSAPP_WEBHOOK_URL  Authorization: Bearer WHATSAPP_WEBHOOK_TOKEN  corpo: { telefone, mensagem }

import type { Prisma } from '@prisma/client';
import { codigoReserva } from '../../shared/codigoReserva';
import { diaMesDe, formatarBR, horaDe } from '../../shared/datasBR';
import { MENSAGEM_PADRAO, TEXTO_CONFIRMACAO, preencherMensagem } from '../../shared/mensagemLembrete';

export interface WhatsappProvider {
  /** false = nada sai de verdade (modo log) */
  ativo: boolean;
  // Pode demorar: o WhatsApp por QR espera 30 a 90 s desde o envio anterior (anti-bloqueio). Quem chama roda uma rodada por vez
  enviar: (telefone: string, mensagem: string) => Promise<void>;
  /** false = parar a rodada antes de marcar o próximo (ex.: limite diário do WhatsApp por QR) */
  podeEnviar?: () => boolean;
  /** Recebe as respostas dos clientes (só o QR code): só então o lembrete pode perguntar 1/2 */
  recebeRespostas?: boolean;
}

const TEMPO_LIMITE_MS = 8000;

export const criarWhatsappHttp = (opcoes: { url: string; token: string }, buscar: typeof fetch = fetch): WhatsappProvider => ({
  ativo: true,
  enviar: async (telefone, mensagem) => {
    const resposta = await buscar(opcoes.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opcoes.token}` },
      body: JSON.stringify({ telefone, mensagem }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) throw new Error(`Provedor de WhatsApp respondeu ${resposta.status}.`);
  },
});

export const criarWhatsappLog = (mascarar: (telefone: string) => string, log: (texto: string) => void = console.log): WhatsappProvider => ({
  ativo: false,
  enviar: async (telefone) => log(`[WHATSAPP] desativado: mensagem para ${mascarar(telefone)} não enviada.`),
});

/** Por rodada do job: o que passar fica para a próxima (10 min depois), já que os enviados são marcados */
export const LIMITE_LEMBRETES_POR_RODADA = 200;

/** Quem recebe lembrete: marcado, na janela, sem reserva aguardando pagamento, cliente não removido e sem opt-out (LGPD) */
export const filtroLembretes = (de: Date, ate: Date): Prisma.AgendamentoWhereInput => ({
  status: 'scheduled',
  data: { gte: de, lte: ate },
  statusPagamento: { not: 'aguardando_pagamento' },
  cliente: { removidoEm: null, telefone: { not: null }, naoReceberWhatsapp: false },
});

export type AgendamentoParaLembrete = { id: string; data: Date; clienteNome: string; clienteTelefone: string | null };


export type EmpresaDoLembrete = { nome: string; telefone?: string | null; endereco?: string | null; mensagens?: string[]; pedeConfirmacao?: boolean };

// Sem nome de serviço nem dado de saúde: a mensagem pode ser lida por quem pegar o celular. Com mensagens da casa,
// sorteia uma (variar o texto também ajuda o número a não ser bloqueado)
export const montarLembrete = (empresa: EmpresaDoLembrete, ag: AgendamentoParaLembrete, sorteio = Math.random()) =>
  textoDoLembrete(empresa, ag, sorteio) + (empresa.pedeConfirmacao === true ? TEXTO_CONFIRMACAO : '');

const textoDoLembrete = (dadosEmpresa: EmpresaDoLembrete, ag: AgendamentoParaLembrete, sorteio: number) => {
  const primeiroNome = ag.clienteNome.trim().split(/\s+/)[0] || ag.clienteNome;
  const data = diaMesDe(ag.data);
  const horario = horaDe(ag.data);
  const escritas = dadosEmpresa.mensagens?.filter((m) => m.trim()) ?? [];
  const modelos = escritas.length ? escritas : [MENSAGEM_PADRAO];
  return preencherMensagem(modelos[Math.floor(sorteio * modelos.length) % modelos.length], {
    nome: primeiroNome,
    data,
    horario,
    'dia da semana': formatarBR(ag.data, { weekday: 'long' }),
    'numero da reserva': codigoReserva(ag.id),
    'nome da empresa': dadosEmpresa.nome,
    'telefone da empresa': dadosEmpresa.telefone ?? '',
    endereco: dadosEmpresa.endereco ?? '',
  });
};

// Lembretes de 24h: quem começa entre 2h e 24h a partir de agora. `marcarUmaVez` devolve false se já foi enviado
// (Redis SET NX), então rodar o job de novo, ou em duas instâncias, não manda duas vezes.
export const enviarLembretes = async (deps: {
  provider: WhatsappProvider;
  empresa: EmpresaDoLembrete;
  agora: Date;
  buscar: (de: Date, ate: Date) => Promise<AgendamentoParaLembrete[]>;
  marcarUmaVez: (agendamentoId: string) => Promise<boolean>;
  registrarFalha?: (agendamentoId: string, erro: unknown) => void;
  // Com a confirmação ligada (empresa.pedeConfirmacao): se ESTE lembrete leva a pergunta 1/2 (ex.: não, quando o
  // número já espera resposta de outro atendimento: um "2" não pode valer para dois)
  podePerguntar?: (ag: AgendamentoParaLembrete) => Promise<boolean>;
  // Lembrete entregue; `perguntou` = foi com a pergunta 1/2 (guardar o número para ligar a resposta ao agendamento)
  aoEnviar?: (ag: AgendamentoParaLembrete, perguntou: boolean) => Promise<void>;
}) => {
  const de = new Date(deps.agora.getTime() + 2 * 3_600_000);
  const ate = new Date(deps.agora.getTime() + 24 * 3_600_000);
  let enviados = 0;
  for (const ag of await deps.buscar(de, ate)) {
    if (!ag.clienteTelefone) continue;
    if (deps.provider.podeEnviar && !deps.provider.podeEnviar()) break;
    if (!(await deps.marcarUmaVez(ag.id))) continue;
    try {
      const perguntar = deps.empresa.pedeConfirmacao === true && deps.provider.recebeRespostas === true
        && (await deps.podePerguntar?.(ag) ?? true);
      await deps.provider.enviar(ag.clienteTelefone, montarLembrete({ ...deps.empresa, pedeConfirmacao: perguntar }, ag));
      enviados += 1;
      await deps.aoEnviar?.(ag, perguntar);
    } catch (erro) {
      deps.registrarFalha?.(ag.id, erro);
    }
  }
  return enviados;
};
