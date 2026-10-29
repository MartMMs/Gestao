import React from 'react';
import { motion } from 'motion/react';
import { Voucher, ConfiguracaoEmpresa } from '../../../types';
import { formatarReais } from '../utils/moeda';

interface StepSuccessVoucherProps {
  voucher: Voucher;
  onReset: () => void;
  empresa?: ConfiguracaoEmpresa | null;
}

export function StepSuccessVoucher({ voucher, onReset, empresa }: StepSuccessVoucherProps) {
  const handlePrint = () => {
    window.print();
  };

  const handleShareWhatsApp = () => {
    const nomeNegocio = empresa?.nomeEmpresa || 'Comprovante de Agendamento';
    const text = encodeURIComponent(
      `✨ *Meu Comprovante - ${nomeNegocio}* ✨\n\n` +
      `Código: ${voucher.codigoConfirmacao}\n` +
      `Serviço: ${voucher.terapiaNome} (${voucher.duracaoMin} min)\n` +
      `Data: ${voucher.data} às ${voucher.horario}\n` +
      `Espaço: ${voucher.salaNome}\n` +
      `Profissional: ${voucher.terapeutaNome}\n\n` +
      `Recomendação: Chegar com 10 minutos de antecedência na recepção.`
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Topo Festivo de Confirmação */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-2"
      >
        <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-600 mb-2">
          <span className="material-symbols-outlined text-4xl">check_circle</span>
        </div>
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-emerald-600 bg-emerald-500/10 px-3 py-1 rounded-full">
          {voucher.statusPagamento === 'aguardando_pagamento' ? 'Reserva Registrada!' : 'Reserva Confirmada com Sucesso!'}
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          Seu Momento de Bem-Estar Está Garantido
        </h2>
        <p className="text-xs sm:text-sm text-on-surface-variant font-body">
          Enviamos uma cópia do seu voucher e orientações de check-in para o seu WhatsApp ({voucher.clienteTelefone}).
        </p>
      </motion.div>

      {/* Cartão de Embarque / Voucher de Atendimento */}
      <div className="bg-surface-container-lowest border-2 border-primary/25 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 relative overflow-hidden print:border print:shadow-none">
        {/* Faixa Decorativa de Fundo */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-emerald-500 to-primary" />

        {/* Cabeçalho do Voucher */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-outline-variant/20 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-primary/10 rounded-2xl flex items-center justify-center text-primary border border-primary/20">
              <span className="material-symbols-outlined text-2xl">{empresa?.icone || 'storefront'}</span>
            </div>
            <div>
              <h3 className="text-lg font-serif italic text-primary">{empresa?.nomeEmpresa || 'Comprovante Oficial'}</h3>
              <p className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant">
                Voucher Oficial de Atendimento
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-[10px] uppercase font-bold tracking-widest text-on-surface-variant block">
              Código da Reserva
            </span>
            <span className="text-lg sm:text-xl font-mono font-bold text-primary tracking-wider">
              {voucher.codigoConfirmacao}
            </span>
          </div>
        </div>

        {/* Detalhes do Cliente e Ritual */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/15">
            <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant block mb-1">
              Hóspede / Cliente
            </span>
            <p className="font-bold text-sm text-on-surface">{voucher.clienteNome}</p>
            <p className="text-[11px] text-on-surface-variant">{voucher.clienteTelefone}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/15">
            <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant block mb-1">
              Produtos / Serviços & Duração
            </span>
            <p className="font-bold text-sm text-primary">{voucher.terapiaNome}</p>
            <p className="text-[11px] text-on-surface-variant">{voucher.duracaoMin} minutos de atendimento</p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/15">
            <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant block mb-1">
              Data & Horário
            </span>
            <p className="font-bold text-sm text-on-surface">
              {voucher.data} às <strong className="text-primary">{voucher.horario}</strong>
            </p>
            <p className="text-[10px] text-emerald-600 font-medium">Chegada recomendada: 10 min antes</p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/15">
            <span className="text-[10px] uppercase font-bold tracking-wider text-on-surface-variant block mb-1">
              Espaço & Profissional
            </span>
            <p className="font-bold text-sm text-on-surface">{voucher.salaNome}</p>
            <p className="text-[11px] text-on-surface-variant">Profissional: {voucher.terapeutaNome}</p>
          </div>
        </div>

        {/* Status de Pagamento */}
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-700 block">
              Status do Pagamento
            </span>
            <span className="text-sm font-bold text-emerald-800">
              {voucher.valorTotal === 0
                ? 'Sem custo'
                : voucher.statusPagamento === 'aguardando_pagamento'
                ? `Aguardando confirmação do pagamento (${formatarReais(voucher.valorSinal)} de ${formatarReais(voucher.valorTotal)})`
                : voucher.statusPagamento === 'integral_pago'
                ? `100% Quitado (${formatarReais(voucher.valorTotal)})`
                : voucher.valorSinal === 0 || voucher.statusPagamento.toLowerCase().includes('recepção') || voucher.statusPagamento.toLowerCase().includes('local')
                ? `A Pagar na Recepção (${formatarReais(voucher.valorTotal)})`
                : `Sinal Confirmado (${formatarReais(voucher.valorSinal)} de ${formatarReais(voucher.valorTotal)})`}
            </span>
          </div>

          <span className={`material-symbols-outlined text-3xl ${voucher.statusPagamento === 'aguardando_pagamento' ? 'text-amber-600' : 'text-emerald-600'}`}>
            {voucher.statusPagamento === 'aguardando_pagamento' ? 'schedule' : 'verified'}
          </span>
        </div>

        {/* Orientações de Check-In */}
        <div className="space-y-2 border-t border-outline-variant/15 pt-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-primary">info</span>
            Orientações de Check-In
          </h4>
          <ul className="space-y-1.5 text-[11px] text-on-surface-variant">
            {voucher.orientacoesCheckIn.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-primary font-bold">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Política de Cancelamento */}
        <div className="text-[10px] text-outline-variant border-t border-outline-variant/15 pt-3">
          <strong>Política de Cancelamento:</strong> {voucher.politicaCancelamento}
        </div>
      </div>

      {/* Botões de Ação */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 print:hidden">
        <button
          type="button"
          onClick={handlePrint}
          className="w-full sm:w-auto px-6 py-3 rounded-xl border border-outline-variant/30 text-xs font-bold uppercase tracking-wider text-on-surface hover:text-primary hover:border-primary/40 transition-colors flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          <span>Imprimir / Salvar PDF</span>
        </button>

        <button
          type="button"
          onClick={handleShareWhatsApp}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase tracking-wider hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <span className="material-symbols-outlined text-[18px]">send</span>
          <span>Compartilhar WhatsApp</span>
        </button>

        <button
          type="button"
          onClick={onReset}
          className="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary text-on-primary font-bold text-xs uppercase tracking-wider hover:bg-primary-dim transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          <span>Novo Agendamento</span>
        </button>
      </div>
    </div>
  );
}
