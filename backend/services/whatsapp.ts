// Envio de mensagens por WhatsApp atrás de um provider: HTTP genérico (seu provedor ou um serviço intermediário)
// ou só registro no log, com telefone mascarado, quando WHATSAPP_WEBHOOK_URL não está definida. Puro (sem banco).
//   POST WHATSAPP_WEBHOOK_URL  Authorization: Bearer WHATSAPP_WEBHOOK_TOKEN  corpo: { telefone, mensagem }

import type { Prisma } from '@prisma/client';

export interface WhatsappProvider {
  /** false = nada sai de verdade (modo log) */
  ativo: boolean;
  enviar: (telefone: string, mensagem: string) => Promise<void>;
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

/** Quem recebe lembrete: marcado, na janela, sem reserva aguardando pagamento e com cliente não removido (LGPD) */
export const filtroLembretes = (de: Date, ate: Date): Prisma.AgendamentoWhereInput => ({
  status: 'scheduled',
  data: { gte: de, lte: ate },
  statusPagamento: { not: 'aguardando_pagamento' },
  cliente: { removidoEm: null, telefone: { not: null } },
});

export type AgendamentoParaLembrete = { id: string; data: Date; clienteNome: string; clienteTelefone: string | null };

const formatar = (data: Date, opcoes: Intl.DateTimeFormatOptions) => data.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes });

// Sem nome de serviço nem dado de saúde: a mensagem pode ser lida por quem pegar o celular
export const montarLembrete = (empresa: string, ag: AgendamentoParaLembrete) => {
  const primeiroNome = ag.clienteNome.trim().split(/\s+/)[0] || ag.clienteNome;
  return `*${empresa}*\nOlá, ${primeiroNome}! Lembrete do seu horário em ${formatar(ag.data, { day: '2-digit', month: '2-digit' })} às ${formatar(ag.data, { hour: '2-digit', minute: '2-digit' })}. Se não puder vir, avise a recepção.`;
};

// Lembretes de 24h: quem começa entre 2h e 24h a partir de agora. `marcarUmaVez` devolve false se já foi enviado
// (Redis SET NX), então rodar o job de novo, ou em duas instâncias, não manda duas vezes.
export const enviarLembretes = async (deps: {
  provider: WhatsappProvider;
  empresa: string;
  agora: Date;
  buscar: (de: Date, ate: Date) => Promise<AgendamentoParaLembrete[]>;
  marcarUmaVez: (agendamentoId: string) => Promise<boolean>;
  registrarFalha?: (agendamentoId: string, erro: unknown) => void;
}) => {
  const de = new Date(deps.agora.getTime() + 2 * 3_600_000);
  const ate = new Date(deps.agora.getTime() + 24 * 3_600_000);
  let enviados = 0;
  for (const ag of await deps.buscar(de, ate)) {
    if (!ag.clienteTelefone) continue;
    if (!(await deps.marcarUmaVez(ag.id))) continue;
    try {
      await deps.provider.enviar(ag.clienteTelefone, montarLembrete(deps.empresa, ag));
      enviados += 1;
    } catch (erro) {
      deps.registrarFalha?.(ag.id, erro);
    }
  }
  return enviados;
};
