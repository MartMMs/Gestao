import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AutoatendimentoReservaSession, Voucher } from '../../../types';
import { confirmarPagamentoAutoatendimento } from '../services/autoatendimentoService';
import { formatarReais } from '../utils/moeda';
import { mensagemDeErro } from '../utils/erros';

interface StepCheckoutProps {
  reservation: AutoatendimentoReservaSession;
  clientData: {
    nome: string;
    telefone: string;
    cpf: string;
    observacoesSaude: string;
  };
  onPaymentSuccess: (voucher: Voucher) => void;
  onExpired: () => void;
  onBack: () => void;
}

export function StepCheckout({
  reservation,
  clientData,
  onPaymentSuccess,
  onExpired,
  onBack,
}: StepCheckoutProps) {
  // Cronômetro regressivo sincronizado com a trava da reserva no servidor
  const totalSeconds = Math.max(60, (reservation.tempoLockMinutos || 10) * 60);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    Math.max(0, Math.floor((reservation.lockExpiresAt - Date.now()) / 1000)));

  const [tipoPagamento, setTipoPagamento] = useState<'sinal' | 'integral'>('sinal');
  const [metodoPagamento, setMetodoPagamento] = useState<'pix' | 'cartao'>('pix');
  const [copiedPix, setCopiedPix] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cartão: só aparece quando o gateway aceita cartão (cartaoOnlineDisponivel)
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState(clientData.nome);

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((reservation.lockExpiresAt - Date.now()) / 1000);
      if (diff <= 0) {
        clearInterval(timer);
        setRemainingSeconds(0);
        onExpired();
      } else {
        setRemainingSeconds(diff);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [reservation.lockExpiresAt, onExpired]);

  const valorCobrado = tipoPagamento === 'integral' ? reservation.valorTotal : reservation.valorSinal;
  const valorRestante = reservation.valorTotal - reservation.valorSinal;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / totalSeconds) * 100));

  // O código Pix vem do gateway do banco; nunca é montado aqui (um código inventado é recusado pelo app do banco)
  const pixCode = (tipoPagamento === 'integral' ? reservation.pixCopiaEColaIntegral : reservation.pixCopiaECola) ?? null;
  const cartaoDisponivel = reservation.cartaoOnlineDisponivel === true;

  const handleCopyPix = () => {
    if (!pixCode) return;
    navigator.clipboard.writeText(pixCode);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 3000);
  };

  // Validação local do cartão (Luhn, validade futura, CVV). Os dados do cartão não são enviados ao servidor.
  const cardDigits = cardNumber.replace(/\D/g, '');
  const luhnValido = cardDigits.length >= 13 && cardDigits.length <= 19 && cardDigits
    .split('')
    .reverse()
    .reduce((soma, d, i) => {
      let n = Number(d);
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      return soma + n;
    }, 0) % 10 === 0;
  const [mesCartao, anoCartao] = cardExpiry.split('/').map(Number);
  const hoje = new Date();
  const validadeOk = mesCartao >= 1 && mesCartao <= 12 && Number.isInteger(anoCartao)
    && (2000 + anoCartao > hoje.getFullYear() || (2000 + anoCartao === hoje.getFullYear() && mesCartao >= hoje.getMonth() + 1));
  const cartaoValido = luhnValido && validadeOk && /^\d{3,4}$/.test(cardCvv) && cardName.trim().length >= 3;

  const handleProcessPayment = async () => {
    if (isProcessing) return;
    if (reservation.exigirPagamento !== false && metodoPagamento === 'pix' && !pixCode) {
      setError('O pagamento por Pix ainda não está disponível. Procure a recepção para concluir sua reserva.');
      return;
    }
    if (metodoPagamento === 'cartao' && !cartaoValido) {
      setError('Confira os dados do cartão: número, validade (MM/AA), CVV e nome impresso.');
      return;
    }
    setIsProcessing(true);
    setError(null);

    try {
      const isSemPagamento = reservation.exigirPagamento === false;
      const res = await confirmarPagamentoAutoatendimento({
        sessionToken: reservation.sessionToken,
        cliente: clientData,
        metodoPagamento: isSemPagamento ? 'presencial_no_local' : metodoPagamento,
        tipoPagamento: isSemPagamento ? 'local' : tipoPagamento,
      });

      onPaymentSuccess(res.voucher);
    } catch (err: unknown) {
      setError(mensagemDeErro(err, 'Falha ao processar agendamento.'));
      setIsProcessing(false);
    }
  };

  const isSemPagamento = reservation.exigirPagamento === false;
  const percentualExibido = reservation.percentualSinal ?? 40;

  return (
    <div className="space-y-6">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
          Etapa 4 de 4 · {isSemPagamento ? 'Confirmação do Agendamento' : 'Garantia da Reserva'}
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          {isSemPagamento ? 'Agendamento com Pagamento no Local' : 'Pagamento & Confirmação'}
        </h2>
        <p className="text-sm text-on-surface-variant font-body">
          {isSemPagamento
            ? 'Seu horário e cabine serão confirmados imediatamente. O valor será pago no balcão da recepção.'
            : 'Seu horário está bloqueado com exclusividade no sistema enquanto você conclui o pagamento.'}
        </p>
      </div>

      {/* Modo Sem Pagamento Online: Pagamento Presencial na Recepção */}
      {isSemPagamento ? (
        <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3.5 p-4 sm:p-5 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-700 shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-2xl sm:text-3xl">storefront</span>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-emerald-700">Pagamento Presencial na Recepção</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Não é necessário pagar online agora. Ao confirmar, seu horário e terapeuta ficam 100% garantidos!
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-b border-outline-variant/15 py-4 text-xs">
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Produtos / Serviços</span>
              <span className="font-bold text-on-surface text-sm">{reservation.servicoNome} ({reservation.duracao} min)</span>
            </div>
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Data & Horário</span>
              <span className="font-bold text-primary text-sm">{reservation.data} às {reservation.horario}</span>
            </div>
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Espaço / Sala</span>
              <span className="font-bold text-on-surface">{reservation.salaNome}</span>
            </div>
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Profissional Responsável</span>
              <span className="font-bold text-on-surface">{reservation.terapeutaNome}</span>
            </div>
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Cliente</span>
              <span className="font-bold text-on-surface">{clientData.nome} ({clientData.telefone})</span>
            </div>
            <div>
              <span className="text-outline-variant uppercase text-[10px] font-bold block">Valor Total a Pagar na Recepção</span>
              <span className="font-bold text-emerald-600 text-base">{formatarReais(reservation.valorTotal)}</span>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleProcessPayment}
              className="w-full py-4 rounded-xl font-bold text-xs uppercase tracking-[0.15em] bg-primary text-on-primary hover:bg-primary-dim transition-all shadow-md flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              {isProcessing ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                  <span>Confirmando Agendamento...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[20px]">check_circle</span>
                  <span>Confirmar Agendamento (Pagar no Local)</span>
                </>
              )}
            </button>
            <p className="text-center text-[11px] text-on-surface-variant">
              Emitiremos seu voucher oficial digital com orientações de chegada e política de cancelamento.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Cronômetro Regressivo com Barra de Urgência */}
          <div className="bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 border border-primary/30 rounded-2xl p-4 sm:p-5 shadow-sm text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-primary font-bold text-xs uppercase tracking-widest">
              <span className="material-symbols-outlined text-[20px] animate-pulse">timer</span>
              <span>Tempo Restante para Concluir a Reserva</span>
            </div>

            <div className="text-3xl sm:text-4xl font-headline font-bold text-primary tracking-wider">
              {timeFormatted}
            </div>

            <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden max-w-md mx-auto">
              <div
                className={`h-full transition-all duration-1000 ${
                  remainingSeconds < 120 ? 'bg-error' : 'bg-primary'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="text-[11px] text-on-surface-variant">
              Após {Math.round(totalSeconds / 60)} minutos, o horário e a cabine serão liberados automaticamente para outros clientes.
            </p>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Opções de Valor: Sinal vs Integral */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              onClick={() => setTipoPagamento('sinal')}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                tipoPagamento === 'sinal'
                  ? 'bg-primary/10 border-primary ring-2 ring-primary/30 shadow-md'
                  : 'bg-surface-container-lowest border-outline-variant/25 text-on-surface hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Pagar Sinal ({percentualExibido}%)
                </span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  Recomendado
                </span>
              </div>
              <p className="text-2xl font-bold font-headline text-on-surface mb-1">
                {formatarReais(reservation.valorSinal)}
              </p>
              <p className="text-[11px] text-on-surface-variant">
                Garante a sala e o profissional agora. O restante de {formatarReais(valorRestante)} é pago na recepção.
              </p>
            </div>

            <div
              onClick={() => setTipoPagamento('integral')}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                tipoPagamento === 'integral'
                  ? 'bg-primary/10 border-primary ring-2 ring-primary/30 shadow-md'
                  : 'bg-surface-container-lowest border-outline-variant/25 text-on-surface hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  Valor Integral (100%)
                </span>
                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Sem Pendências
                </span>
              </div>
              <p className="text-2xl font-bold font-headline text-on-surface mb-1">
                {formatarReais(reservation.valorTotal)}
              </p>
              <p className="text-[11px] text-on-surface-variant">
                Experiência completa 100% quitada antecipadamente. Ao chegar, basta apresentar seu comprovante.
              </p>
            </div>
          </div>

          {/* Seleção do Método de Pagamento */}
          <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/15 pb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">credit_card</span>
                Forma de Pagamento
              </h3>

              <div className="flex bg-surface-container p-1 rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => setMetodoPagamento('pix')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                    metodoPagamento === 'pix'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                  <span>PIX Instantâneo</span>
                </button>

                {cartaoDisponivel && (
                <button
                  type="button"
                  onClick={() => setMetodoPagamento('cartao')}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                    metodoPagamento === 'cartao'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">credit_card</span>
                  <span>Cartão</span>
                </button>
                )}
              </div>
            </div>

        {/* PIX */}
        {metodoPagamento === 'pix' && (
          <div className="flex flex-col md:flex-row items-center gap-6 py-2">
            {/* QR Code Ilustrativo Dinâmico */}
            <div className="w-48 h-48 bg-white p-3 rounded-2xl border-2 border-primary/20 shadow-sm flex flex-col items-center justify-center shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full text-zinc-900">
                <rect width="100" height="100" fill="white" />
                <path
                  d="M10 10h30v30h-30zM15 15h20v20h-20zM20 20h10v10h-10zM60 10h30v30h-30zM65 15h20v20h-20zM70 20h10v10h-10zM10 60h30v30h-30zM15 65h20v20h-20zM20 70h10v10h-10zM50 15h5v5h-5zM50 25h10v5h-10zM50 35h5v5h-5zM20 50h5v10h-5zM30 50h10v5h-10zM60 50h10v5h-10zM75 50h15v5h-15zM50 60h5v15h-5zM60 65h10v5h-10zM80 65h10v10h-10zM60 80h5v10h-5zM70 85h10v5h-10zM85 80h5v10h-5z"
                  fill="currentColor"
                />
              </svg>
              <span className="text-[9px] font-bold uppercase tracking-wider text-primary mt-1">
                PIX BACEN
              </span>
            </div>

            <div className="flex-1 space-y-3 w-full">
              <div>
                <p className="text-xs font-bold text-on-surface">Escaneie o QR Code ou copie o código</p>
                <p className="text-[11px] text-on-surface-variant">
                  Abra o aplicativo do seu banco, escolha <strong>Pix Copia e Cola</strong> e efetue o pagamento de <strong>{formatarReais(valorCobrado)}</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={pixCode ?? 'Código Pix indisponível no momento'}
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-2.5 text-[11px] font-mono text-on-surface-variant truncate select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyPix}
                  disabled={!pixCode}
                  className="px-4 py-2.5 bg-primary/10 text-primary border border-primary/30 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-primary hover:text-on-primary transition-all shrink-0 flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copiedPix ? 'done' : 'content_copy'}
                  </span>
                  <span>{copiedPix ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  disabled={isProcessing || !pixCode}
                  onClick={handleProcessPayment}
                  className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-[0.15em] bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <span className="material-symbols-outlined text-[18px] animate-spin">
                        progress_activity
                      </span>
                      <span>Registrando sua reserva...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      <span>Fiz o PIX / Confirmar Reserva</span>
                    </>
                  )}
                </button>
                <p className="mt-2 text-[11px] text-on-surface-variant text-center">
                  Sua reserva fica registrada como aguardando pagamento até o banco confirmar o PIX.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Cartão de Crédito */}
        {cartaoDisponivel && metodoPagamento === 'cartao' && (
          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1">
                Número do Cartão
              </label>
              <input
                type="text"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="0000 0000 0000 0000"
                maxLength={19}
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 text-sm text-on-surface"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">
                  Validade
                </label>
                <input
                  type="text"
                  value={cardExpiry}
                  onChange={(e) => setCardExpiry(e.target.value)}
                  placeholder="MM/AA"
                  maxLength={5}
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 text-sm text-on-surface"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1">
                  CVV
                </label>
                <input
                  type="text"
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value)}
                  placeholder="123"
                  maxLength={4}
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 text-sm text-on-surface"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1">
                Nome Impresso no Cartão
              </label>
              <input
                type="text"
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                placeholder="Como consta no cartão"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 text-sm text-on-surface"
              />
            </div>

            <button
              type="button"
              disabled={isProcessing || !cartaoValido}
              onClick={handleProcessPayment}
              className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-[0.15em] bg-primary text-on-primary hover:bg-primary-dim transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">
                    progress_activity
                  </span>
                  <span>Enviando pagamento...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  <span>Pagar {formatarReais(valorCobrado)}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
      </>
      )}

      {/* Botão de Voltar */}
      <div className="pt-2 flex justify-start">
        <button
          type="button"
          onClick={onBack}
          disabled={isProcessing}
          className="disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Voltar para Ficha de Saúde</span>
        </button>
      </div>
    </div>
  );
}
