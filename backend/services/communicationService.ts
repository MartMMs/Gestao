import { diaMesBR } from '../../shared/agenda';
import { codigoReserva } from '../../shared/codigoReserva';
import { mascararTelefone } from '../lib/privacidade';
import { getEmpresaConfig } from './configService';
import { config as ambiente } from '../env';
import { criarWhatsappHttp, criarWhatsappLog } from './whatsapp';

export const whatsapp = ambiente.whatsappUrl
  ? criarWhatsappHttp({ url: ambiente.whatsappUrl, token: ambiente.whatsappToken })
  : criarWhatsappLog((telefone) => mascararTelefone(telefone) ?? '');

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

class CommunicationService {
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
    const codigoConfirmacao = codigoReserva(data.id);

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
        'Se algo mudou desde a reserva (saúde, restrições, preferências), avise o profissional no início do atendimento.',
      ],
    };
  }

  // Confirmação da reserva do totem. Os lembretes de 24h saem pelo job (enviarLembretes), para todos os agendamentos
  async enviarConfirmacao(voucher: VoucherData): Promise<void> {
    // Nome da clínica configurado (nunca uma marca fixa no código)
    const empresa = (await getEmpresaConfig()).nomeEmpresa;
    const aguardandoPagamento = voucher.statusPagamento === 'aguardando_pagamento';
    // Mesma regra do lembrete: primeiro nome, dia e hora, sem profissional, sala nem serviço (a prévia da mensagem
    // aparece com o celular bloqueado, e um telefone digitado errado entrega a mensagem a outra pessoa)
    const primeiroNome = voucher.clienteNome.trim().split(/\s+/)[0] || voucher.clienteNome;
    const mensagem = `*${empresa}*\nOlá, ${primeiroNome}! ${aguardandoPagamento ? 'Recebemos sua reserva! Ela será confirmada assim que o pagamento for aprovado.' : 'Sua reserva foi confirmada.'}\n🗓️ ${diaMesBR(voucher.data)} às ${voucher.horario} · código ${voucher.codigoConfirmacao}\n\nRecomendamos chegar 15 minutos antes.`;
    await whatsapp.enviar(voucher.clienteTelefone, mensagem);
  }
}

export const communicationService = new CommunicationService();
