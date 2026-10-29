import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import io from 'socket.io-client';
import { getSocketUrl } from '../../../config/api';
import { Service, AutoatendimentoReservaSession, AutoatendimentoConfig, ConfiguracaoEmpresa, Voucher } from '../../../types';
import {
  fetchAutoatendimentoServicos,
  fetchAutoatendimentoConfig,
  fetchAutoatendimentoEmpresa,
  cancelarReservaAutoatendimento,
} from '../services/autoatendimentoService';
import { StepCatalog } from './StepCatalog';
import { StepSchedule } from './StepSchedule';
import { StepIdentification, limparRascunhoIdentificacao } from './StepIdentification';
import { StepCheckout } from './StepCheckout';
import { StepSuccessVoucher } from './StepSuccessVoucher';

// Sem toque nesse tempo, o totem recomeça (o voucher, com dados do cliente, sai da tela antes)
const TEMPO_INATIVIDADE_MS = 2 * 60_000;
const TEMPO_VOUCHER_NA_TELA_MS = 60_000;

interface AutoatendimentoViewProps {
  onExitToPortal?: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

export function AutoatendimentoView({ onExitToPortal }: AutoatendimentoViewProps) {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [services, setServices] = useState<Service[]>([]);
  const [config, setConfig] = useState<AutoatendimentoConfig | null>(null);
  const [empresa, setEmpresa] = useState<ConfiguracaoEmpresa | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estados do funil
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [reservation, setReservation] = useState<AutoatendimentoReservaSession | null>(null);
  const [clientData, setClientData] = useState<{
    nome: string;
    telefone: string;
    cpf: string;
    observacoesSaude: string;
  } | null>(null);
  const [voucher, setVoucher] = useState<Voucher | null>(null);

  // Modal de expiração
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  const stepsNav = useMemo(() => [
    { step: 1, label: (empresa?.termoServico || 'Produtos & Serviços').split('/')[0].trim(), icon: empresa?.icone || 'menu_book' },
    { step: 2, label: 'Horário', icon: 'schedule' },
    { step: 3, label: 'Dados', icon: 'person' },
    {
      step: 4,
      label: config?.exigirPagamento === false ? 'Confirmação' : 'Pagamento',
      icon: config?.exigirPagamento === false ? 'task_alt' : 'payment',
    },
  ], [config?.exigirPagamento, empresa]);

  // Carrega o catálogo, a configuração e dados da empresa na montagem
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchAutoatendimentoServicos(),
      fetchAutoatendimentoConfig().catch(() => null),
      fetchAutoatendimentoEmpresa().catch(() => null),
    ])
      .then(([servicosData, configData, empresaData]) => {
        if (mounted) {
          setServices(servicosData || []);
          if (configData) setConfig(configData);
          if (empresaData) setEmpresa(empresaData);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || 'Falha ao carregar catálogo.');
          setLoading(false);
        }
      });

    // Conexão em tempo real via WebSocket: se o admin adicionar/editar itens, atualiza na hora!
    const socket = io(getSocketUrl(), { transports: ['websocket', 'polling'] });

    socket.on('db_updated', (payload?: { escopos?: string[] }) => {
      // Reserva de outro cliente não muda o catálogo: só recarrega quando serviços/equipe mudaram
      const escopos = payload?.escopos;
      if (Array.isArray(escopos) && escopos.length > 0 && !escopos.some((e) => e === 'services' || e === 'employees')) return;
      fetchAutoatendimentoServicos().then((servicosData) => {
        if (mounted) setServices(servicosData || []);
      });
    });

    socket.on('autoatendimento:config_atualizada', (newConfig) => {
      if (mounted) setConfig(newConfig);
    });

    socket.on('empresa:config_atualizada', (newEmpresa) => {
      if (mounted) setEmpresa(newEmpresa);
    });

    return () => {
      mounted = false;
      socket.disconnect();
    };
  }, []);

  // Reserva pendente (etapas 3 e 4): libera o horário ao fechar/recarregar a aba
  const temReservaPendente = Boolean(reservation) && (currentStep === 3 || currentStep === 4);
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (reservation && temReservaPendente) {
        cancelarReservaAutoatendimento(reservation.sessionToken);
      }
    };
    // pagehide cobre o "voltar" do navegador e o Safari do celular, onde beforeunload nem sempre dispara
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [reservation, temReservaPendente]);

  // Alterna itens no carrinho de produtos / serviços
  const handleToggleService = (service: Service) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.id === service.id);
      const updated = exists ? prev.filter((s) => s.id !== service.id) : [...prev, service];
      setSelectedService(updated[0] || null);
      return updated;
    });
  };

  const handleSelectSingleService = (service: Service) => {
    setSelectedServices([service]);
    setSelectedService(service);
  };

  // Transições de etapa
  const handleSelectServiceAndContinue = () => {
    if (selectedServices.length > 0 || selectedService) {
      setCurrentStep(2);
    }
  };

  const handleSlotReserved = (session: {
    sessionToken: string;
    lockExpiresAt: number;
    detalhes: AutoatendimentoReservaSession;
  }) => {
    setReservation(session.detalhes);
    setCurrentStep(3);
  };

  const handleIdentificationSubmit = (data: {
    nome: string;
    telefone: string;
    cpf: string;
    observacoesSaude: string;
  }) => {
    setClientData(data);
    setCurrentStep(4);
  };

  const handlePaymentSuccess = (voucherData: Voucher) => {
    limparRascunhoIdentificacao();
    setVoucher(voucherData);
    setCurrentStep(5);
  };

  const handleReservationExpired = () => {
    setShowExpiredModal(true);
  };

  const handleRestart = () => {
    limparRascunhoIdentificacao();
    if (reservation) {
      cancelarReservaAutoatendimento(reservation.sessionToken);
    }
    setReservation(null);
    setClientData(null);
    setVoucher(null);
    setSelectedServices([]);
    setSelectedService(null);
    setShowExpiredModal(false);
    setCurrentStep(1);
  };

  // Sair para o portal no meio do fluxo também devolve o horário para a grade
  const handleExitToPortal = () => {
    limparRascunhoIdentificacao();
    if (reservation && temReservaPendente) cancelarReservaAutoatendimento(reservation.sessionToken);
    onExitToPortal?.();
  };

  // Cronômetro da reserva também na etapa de dados (a etapa 4 tem o próprio)
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null);
  useEffect(() => {
    if (!reservation || currentStep !== 3) {
      setSegundosRestantes(null);
      return;
    }
    const atualizar = () => {
      const restante = Math.max(0, Math.floor((reservation.lockExpiresAt - Date.now()) / 1000));
      setSegundosRestantes(restante);
      if (restante === 0) setShowExpiredModal(true);
    };
    atualizar();
    const timer = setInterval(atualizar, 1000);
    return () => clearInterval(timer);
  }, [reservation, currentStep]);

  const handleStepBackFromSchedule = () => {
    setCurrentStep(1);
  };

  const handleStepBackFromId = () => {
    // Totem público: ao sair da etapa de dados, nada do que foi digitado (inclusive saúde) fica para o próximo
    limparRascunhoIdentificacao();
    setClientData(null);
    if (reservation) {
      cancelarReservaAutoatendimento(reservation.sessionToken);
      setReservation(null);
    }
    setCurrentStep(2);
  };

  const handleStepBackFromCheckout = () => {
    setCurrentStep(3);
  };

  // Totem público: sem interação, volta ao início e descarta tudo (dados digitados, reserva e voucher na tela)
  const reiniciarRef = useRef(handleRestart);
  reiniciarRef.current = handleRestart;
  useEffect(() => {
    if (currentStep === 1) return;
    const limiteMs = currentStep === 5 ? TEMPO_VOUCHER_NA_TELA_MS : TEMPO_INATIVIDADE_MS;
    let timer = setTimeout(() => reiniciarRef.current(), limiteMs);
    const registrarAtividade = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reiniciarRef.current(), limiteMs);
    };
    const eventos = ['pointerdown', 'keydown', 'touchstart'] as const;
    eventos.forEach((e) => window.addEventListener(e, registrarAtividade));
    return () => {
      clearTimeout(timer);
      eventos.forEach((e) => window.removeEventListener(e, registrarAtividade));
    };
  }, [currentStep]);

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Barra de Cabeçalho / Branding e Botão Voltar ao Portal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-outline-variant/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-xs">
            <span className="material-symbols-outlined text-2xl sm:text-3xl">{empresa?.icone || 'storefront'}</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-serif italic text-primary font-bold leading-tight line-clamp-2 break-words">
              {empresa?.nomeEmpresa || 'Autoatendimento'}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[10px] sm:text-xs uppercase tracking-widest text-on-surface-variant/90 font-bold">
                Totem Autoatendimento
              </span>
            </div>
          </div>
        </div>
        {/* No subdomínio do totem não há portal para voltar: o cliente recomeça, e a reserva em aberto é liberada */}
        {!onExitToPortal && currentStep > 1 && currentStep <= 4 && (
          <button
            type="button"
            onClick={handleRestart}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant/30 text-xs font-semibold text-on-surface-variant hover:text-primary hover:border-primary/40 bg-surface-container transition-all cursor-pointer shadow-xs shrink-0 self-start sm:self-auto active:scale-95"
            title="Recomeçar"
          >
            <span className="material-symbols-outlined text-base">restart_alt</span>
            <span className="whitespace-nowrap">Recomeçar</span>
          </button>
        )}
        {onExitToPortal && (
          <button
            type="button"
            onClick={handleExitToPortal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-outline-variant/30 text-xs font-semibold text-on-surface-variant hover:text-primary hover:border-primary/40 bg-surface-container transition-all cursor-pointer shadow-xs shrink-0 self-start sm:self-auto active:scale-95"
            title="Voltar ao Portal"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span className="whitespace-nowrap">Voltar ao Portal</span>
          </button>
        )}
      </div>

      {/* Barra de Progresso Superior com Ícones Espaçosos */}
      {currentStep <= 4 && (
        <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between max-w-3xl mx-auto relative px-2 sm:px-6">
            {/* Linha de Conexão */}
            <div className="absolute top-1/2 left-8 right-8 -translate-y-1/2 h-0.5 bg-outline-variant/20 -z-0" />

            {stepsNav.map((s) => {
              const isCompleted = currentStep > s.step;
              const isCurrent = currentStep === s.step;
              return (
                <div key={s.step} className="flex flex-col items-center relative z-10">
                  <div
                    title={s.label}
                    className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center font-bold text-xs sm:text-sm transition-all shadow-xs cursor-default ${
                      isCompleted
                        ? 'bg-emerald-600 text-white shadow-emerald-600/20'
                        : isCurrent
                        ? 'bg-primary text-on-primary ring-4 ring-primary/20 shadow-md scale-105'
                        : 'bg-surface-container text-on-surface-variant border border-outline-variant/30'
                    }`}
                  >
                    {isCompleted ? (
                      <span className="material-symbols-outlined text-[20px] sm:text-[22px]">done</span>
                    ) : (
                      <span className="material-symbols-outlined text-[20px] sm:text-[22px]">{s.icon}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Se o autoatendimento estiver desativado pela administração */}
      {config && !config.ativo ? (
        <div className="bg-surface-container-lowest border border-amber-500/30 rounded-3xl p-8 sm:p-12 text-center max-w-lg mx-auto shadow-sm space-y-5">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-600 mx-auto">
            <span className="material-symbols-outlined text-3xl">build_circle</span>
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold font-headline text-primary">Totem em Pausa Operacional</h3>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              O agendamento por autoatendimento está temporariamente em manutenção pela recepção. Por favor, dirija-se ao balcão para ser atendido por um de nossos especialistas.
            </p>
          </div>
          {onExitToPortal && (
            <button
              type="button"
              onClick={handleExitToPortal}
              className="px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-primary text-on-primary hover:bg-primary-dim transition-all shadow-sm"
            >
              Voltar ao Início
            </button>
          )}
        </div>
      ) : (
        /* Conteúdo Dinâmico por Etapa */
        <div className="min-h-[480px]">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl animate-spin text-primary">
              progress_activity
            </span>
            <p className="text-xs uppercase tracking-widest font-bold">
              Carregando catálogo de autoatendimento...
            </p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-error/10 border border-error/30 text-error text-center space-y-2">
            <span className="material-symbols-outlined text-3xl">error</span>
            <p className="text-sm font-bold">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-error text-white rounded-xl text-xs font-bold uppercase tracking-wider"
            >
              Tentar Novamente
            </button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {currentStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <StepCatalog
                  services={services}
                  selectedServices={selectedServices}
                  onToggleService={handleToggleService}
                  selectedService={selectedService}
                  onSelectService={handleSelectSingleService}
                  onContinue={handleSelectServiceAndContinue}
                  empresa={empresa}
                />
              </motion.div>
            )}

            {currentStep === 2 && (selectedServices.length > 0 || selectedService) && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <StepSchedule
                  services={selectedServices.length > 0 ? selectedServices : (selectedService ? [selectedService] : [])}
                  service={selectedService || selectedServices[0]}
                  onSlotReserved={handleSlotReserved}
                  onBack={handleStepBackFromSchedule}
                />
              </motion.div>
            )}

            {currentStep === 3 && reservation && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                {segundosRestantes !== null && (
                  <p className="mb-4 text-center text-xs font-bold text-primary" role="timer" aria-live="polite">
                    Seu horário fica reservado por mais {String(Math.floor(segundosRestantes / 60)).padStart(2, '0')}:{String(segundosRestantes % 60).padStart(2, '0')}
                  </p>
                )}
                <StepIdentification
                  reservation={reservation}
                  onSubmit={handleIdentificationSubmit}
                  onBack={handleStepBackFromId}
                />
              </motion.div>
            )}

            {currentStep === 4 && reservation && clientData && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <StepCheckout
                  reservation={reservation}
                  clientData={clientData}
                  onPaymentSuccess={handlePaymentSuccess}
                  onExpired={handleReservationExpired}
                  onBack={handleStepBackFromCheckout}
                />
              </motion.div>
            )}

            {currentStep === 5 && voucher && (
              <motion.div
                key="step5"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <StepSuccessVoucher voucher={voucher} onReset={handleRestart} empresa={empresa} />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
      )}

      {/* Modal de Tempo Expirado */}
      {showExpiredModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-error/10 border border-error/20 flex items-center justify-center text-error mx-auto">
              <span className="material-symbols-outlined text-3xl">timer_off</span>
            </div>
            <h3 className="text-xl font-bold font-headline text-primary">
              Tempo de Reserva Expirado
            </h3>
            <p className="text-xs text-on-surface-variant font-body leading-relaxed">
              Para garantir que todos tenham acesso justo aos horários, a reserva temporária de {reservation?.tempoLockMinutos ?? config?.tempoLockMinutos ?? 10} minutos expirou e a cabine foi liberada.
            </p>
            <button
              type="button"
              onClick={handleRestart}
              className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-wider bg-primary text-on-primary hover:bg-primary-dim transition-colors shadow-sm"
            >
              Escolher Novo Horário
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
