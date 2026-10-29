import { instanteNoFuso } from '../../shared/agenda';
import { mascararTelefone } from '../lib/privacidade';

export interface VoucherData {
  reservaId: string;
  codigoConfirmacao: string;
  clienteNome: string;
  clienteTelefone: string;
  terapiaNome: string;
  duracaoMin: number;
  data: string; // YYYY-MM-DD
  horario: string; // HH:mm
  terapeutaNome: string;
  salaNome: string;
  valorTotal: number;
  valorSinal: number;
  statusPagamento: string;
  politicaCancelamento: string;
  orientacoesCheckIn: string[];
}

export interface DisparoFila {
  id: string;
  tipo: 'confirmacao_imediata' | 'lembrete_24h' | 'lembrete_2h';
  canal: 'whatsapp' | 'email';
  destinatario: string;
  conteudo: string;
  status: 'enviado' | 'agendado';
  agendadoPara: Date;
  enviadoEm?: Date;
}

class CommunicationService {
  private queue: DisparoFila[] = [];

  generateVoucher(data: {
    id: string;
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
    politicaCancelamento?: string;
    orientacoesCheckIn?: string[];
  }): VoucherData {
    const hash = data.id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
    const codigoConfirmacao = `SPA-${hash}`;

    return {
      reservaId: data.id,
      codigoConfirmacao,
      clienteNome: data.clienteNome,
      clienteTelefone: data.clienteTelefone,
      terapiaNome: data.terapiaNome,
      duracaoMin: data.duracaoMin,
      data: data.data,
      horario: data.horario,
      terapeutaNome: data.terapeutaNome,
      salaNome: data.salaNome,
      valorTotal: data.valorTotal,
      valorSinal: data.valorSinal,
      statusPagamento: data.statusPagamento,
      politicaCancelamento: data.politicaCancelamento || 'Cancelamento gratuito até 4 horas antes do horário agendado. Tolerância de atraso de 10 minutos.',
      orientacoesCheckIn: data.orientacoesCheckIn || [
        'Chegue com 15 minutos de antecedência na recepção.',
        'Aproveite nosso lounge de descompressão com água saborizada e chá exclusivo.',
        'Utilize trajes confortáveis; fornecemos roupão e toalhas higienizadas.',
        'Caso tenha novas condições de saúde ou desconforto, informe seu terapeuta no início.',
      ],
    };
  }

  async enqueueTransactionalNotifications(voucher: VoucherData): Promise<void> {
    const agora = new Date();
    const dataSessao = instanteNoFuso(voucher.data, voucher.horario);
    const aguardandoPagamento = voucher.statusPagamento === 'aguardando_pagamento';

    // 1. Mensagem de Confirmação Imediata
    const msgConfirmacao: DisparoFila = {
      id: `disp-${Date.now()}-1`,
      tipo: 'confirmacao_imediata',
      canal: 'whatsapp',
      destinatario: voucher.clienteTelefone,
      conteudo: `✨ *Serenidade Spa & Resort* ✨\nOlá, ${voucher.clienteNome}! ${aguardandoPagamento ? 'Recebemos sua reserva! Ela será confirmada assim que o pagamento for aprovado.' : 'Sua reserva foi confirmada com sucesso!'}\n\n📋 *Código:* ${voucher.codigoConfirmacao}\n🌿 *Terapia:* ${voucher.terapiaNome}\n🗓️ *Data:* ${voucher.data} às ${voucher.horario}\n🏠 *Espaço:* ${voucher.salaNome}\n👤 *Terapeuta:* ${voucher.terapeutaNome}\n\nRecomendamos chegar 15 minutos antes para seu ritual de boas-vindas. Esperamos por você!`,
      status: 'enviado',
      agendadoPara: agora,
      enviadoEm: agora,
    };
    this.queue.push(msgConfirmacao);
    console.log(`[COMUNICAÇÃO] 📲 Mensagem transacional enviada para ${mascararTelefone(voucher.clienteTelefone)} (Reserva ${voucher.codigoConfirmacao})`);

    // 2. Lembrete 24h antes
    const data24hAntes = new Date(dataSessao.getTime() - 24 * 60 * 60 * 1000);
    if (data24hAntes > agora) {
      this.queue.push({
        id: `disp-${Date.now()}-2`,
        tipo: 'lembrete_24h',
        canal: 'whatsapp',
        destinatario: voucher.clienteTelefone,
        conteudo: `🌿 *Lembrete Serenidade Spa*: Seu momento de relaxamento (${voucher.terapiaNome}) está agendado para amanhã às ${voucher.horario}. Estamos preparando tudo com carinho!`,
        status: 'agendado',
        agendadoPara: data24hAntes,
      });
      console.log(`[COMUNICAÇÃO] ⏰ Lembrete 24h agendado para ${data24hAntes.toISOString()}`);
    }

    // 3. Lembrete 2h antes
    const data2hAntes = new Date(dataSessao.getTime() - 2 * 60 * 60 * 1000);
    if (data2hAntes > agora) {
      this.queue.push({
        id: `disp-${Date.now()}-3`,
        tipo: 'lembrete_2h',
        canal: 'whatsapp',
        destinatario: voucher.clienteTelefone,
        conteudo: `🌸 *Seu ritual no Serenidade Spa começa em 2 horas!* Lembramos que sua cabine é a *${voucher.salaNome}*. Até breve!`,
        status: 'agendado',
        agendadoPara: data2hAntes,
      });
      console.log(`[COMUNICAÇÃO] ⏰ Lembrete 2h agendado para ${data2hAntes.toISOString()}`);
    }
  }

  getQueue() {
    return this.queue;
  }
}

export const communicationService = new CommunicationService();
