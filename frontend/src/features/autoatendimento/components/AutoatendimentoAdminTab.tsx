import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AutoatendimentoConfig } from '../../../types';
import {
  fetchAutoatendimentoConfig,
  updateAutoatendimentoConfig,
} from '../services/autoatendimentoService';
import { AutoatendimentoView } from './AutoatendimentoView';
import { mensagemDeErro } from '../utils/erros';

export function AutoatendimentoAdminTab() {
  const [config, setConfig] = useState<AutoatendimentoConfig>({
    id: 'default',
    ativo: true,
    exigirPagamento: true,
    percentualSinal: 40,
    tempoLockMinutos: 10,
    permitirCancelamento: true,
    tempoMinimoCancelamentoHoras: 4,
    instrucoesCheckin: 'Chegue com 15 minutos de antecedência para desfrutar do nosso lounge com chá de boas-vindas e aromaterapia.',
    mensagemBoasVindas: 'Bem-vindo ao Serenidade Spa & Resort. Reserve seu momento de bem-estar.',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modo Simulador Mobile
  const [showMobileSimulator, setShowMobileSimulator] = useState(false);
  const [simulatorDevice, setSimulatorDevice] = useState<'iphone' | 'android' | 'tablet'>('iphone');

  useEffect(() => {
    let mounted = true;
    fetchAutoatendimentoConfig()
      .then((data) => {
        if (mounted && data) {
          setConfig(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(mensagemDeErro(err, 'Falha ao buscar configurações.'));
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedSuccess(false);

    try {
      const updated = await updateAutoatendimentoConfig(config);
      setConfig(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err: unknown) {
      setError(mensagemDeErro(err, 'Erro ao salvar configurações.'));
    } finally {
      setSaving(false);
    }
  };

  const deviceWidths = {
    iphone: 'w-[375px] h-[720px]',
    android: 'w-[390px] h-[740px]',
    tablet: 'w-[768px] h-[780px]',
  };

  if (loading) {
    return (
      <div className="min-h-96 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
        <span className="material-symbols-outlined text-4xl animate-spin text-primary">progress_activity</span>
        <p className="text-xs uppercase tracking-widest font-bold">Carregando painel de autoatendimento...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in max-w-6xl mx-auto pb-12">
      {/* Topo do Painel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-2xl">tune</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
              Painel Administrativo
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-headline font-bold text-primary">
            Configurações do Autoatendimento
          </h2>
          <p className="text-xs sm:text-sm text-on-surface-variant font-body">
            Gerencie as regras do totem, ligue/desligue pagamentos online e visualize o layout mobile em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowMobileSimulator(!showMobileSimulator)}
            className={`px-4 py-2.5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer ${
              showMobileSimulator
                ? 'bg-primary text-on-primary border-primary shadow-md'
                : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:text-primary hover:border-primary/40'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {showMobileSimulator ? 'desktop_windows' : 'smartphone'}
            </span>
            <span>{showMobileSimulator ? 'Ocultar Simulador' : 'Simulador Mobile'}</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => handleSave()}
            className="px-6 py-2.5 rounded-xl bg-primary text-on-primary hover:bg-primary-dim font-bold text-xs uppercase tracking-wider shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>Salvar Configurações</span>
              </>
            )}
          </button>
        </div>
      </div>

      {savedSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 text-xs font-semibold flex items-center gap-2.5 shadow-sm"
        >
          <span className="material-symbols-outlined text-lg">check_circle</span>
          <span>Configurações salvas e aplicadas imediatamente em todos os totens e telas do site!</span>
        </motion.div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-error/10 border border-error/30 text-error text-xs font-semibold flex items-center gap-2.5">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Se o simulador mobile estiver ativo */}
      {showMobileSimulator && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-surface-container-low border border-outline-variant/30 rounded-3xl p-6 shadow-xl space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/15 pb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">devices</span>
              <h3 className="font-bold text-sm text-primary uppercase tracking-wider">
                Simulador de Acessibilidade Mobile
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-on-surface-variant font-medium">Dispositivo:</span>
              <button
                type="button"
                onClick={() => setSimulatorDevice('iphone')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  simulatorDevice === 'iphone'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container text-on-surface-variant hover:text-primary'
                }`}
              >
                iPhone (375px)
              </button>
              <button
                type="button"
                onClick={() => setSimulatorDevice('android')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  simulatorDevice === 'android'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container text-on-surface-variant hover:text-primary'
                }`}
              >
                Galaxy (390px)
              </button>
              <button
                type="button"
                onClick={() => setSimulatorDevice('tablet')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  simulatorDevice === 'tablet'
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container text-on-surface-variant hover:text-primary'
                }`}
              >
                Tablet (768px)
              </button>
            </div>
          </div>

          <div className="flex justify-center p-4 bg-black/10 dark:bg-black/40 rounded-2xl overflow-x-auto">
            {/* Moldura do Smartphone */}
            <div
              className={`${deviceWidths[simulatorDevice]} bg-surface-container-lowest border-4 border-neutral-800 rounded-[44px] shadow-2xl overflow-hidden flex flex-col relative transition-all duration-300 ring-8 ring-neutral-900/10`}
            >
              {/* Notch / Speaker */}
              <div className="w-full bg-neutral-900 h-6 flex items-center justify-center relative shrink-0">
                <div className="w-20 h-3.5 bg-black rounded-b-xl flex items-center justify-center">
                  <div className="w-3 h-1 bg-neutral-700 rounded-full" />
                </div>
              </div>

              {/* Tela do Aplicativo com Scroll Independente */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 custom-scrollbar">
                <AutoatendimentoView />
              </div>

              {/* Barra de Navegação Inferior (Home Indicator) */}
              <div className="w-full h-4 bg-neutral-900 flex items-center justify-center shrink-0">
                <div className="w-28 h-1 bg-neutral-500 rounded-full" />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-on-surface-variant pt-2">
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Touch Target Seguro (&gt;= 44px)
            </span>
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Sem Transbordo Horizontal
            </span>
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Scroll Snap de 14 Dias Fluido
            </span>
          </div>
        </motion.div>
      )}

      {/* Grid de Configurações */}
      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Regra de Pagamento (Online vs No Local) */}
        <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-3xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">payments</span>
              </div>
              <div>
                <h3 className="font-bold text-sm text-primary uppercase tracking-wide">
                  Exigência de Pagamento
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Controla se o cliente precisa pagar sinal online ou se agenda sem custo.
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.exigirPagamento}
                onChange={(e) => setConfig({ ...config, exigirPagamento: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-13 h-7 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary" />
            </label>
          </div>

          <div
            className={`p-4 rounded-2xl border text-xs leading-relaxed transition-colors ${
              config.exigirPagamento
                ? 'bg-primary/5 border-primary/20 text-on-surface'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-300'
            }`}
          >
            {config.exigirPagamento ? (
              <div className="space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-primary">
                  <span className="material-symbols-outlined text-[16px]">lock_clock</span>
                  Modo com Pagamento Online Ativado
                </p>
                <p className="text-on-surface-variant">
                  O cliente deve pagar o sinal ({config.percentualSinal}%) ou o valor integral via Pix ou Cartão. O horário fica reservado por {config.tempoLockMinutos} minutos via Redis enquanto realiza o pagamento.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                  <span className="material-symbols-outlined text-[16px]">storefront</span>
                  Modo Apenas Agendamento (Sem Pagamento Online) Ativado
                </p>
                <p>
                  O cliente conclui a reserva diretamente sem etapa de cobrança! O pagamento será realizado presencialmente na recepção do spa no momento do check-in.
                </p>
              </div>
            )}
          </div>

          {config.exigirPagamento && !config.pagamentoOnlineDisponivel && (
            <div className="p-4 rounded-2xl border text-xs leading-relaxed bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300">
              <p className="font-bold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">link_off</span>
                Nenhum gateway de pagamento conectado
              </p>
              <p>
                A opção fica salva, mas enquanto o banco não estiver conectado o totem confirma a reserva e o pagamento é feito na recepção.
                Para ativar a cobrança online, conecte o gateway e configure <code>PAYMENT_WEBHOOK_SECRET</code> no servidor.
              </p>
            </div>
          )}

          {/* Configuração de Percentual de Sinal (quando exigido) */}
          {config.exigirPagamento && (
            <div className="space-y-3 pt-2 border-t border-outline-variant/15">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  Percentual do Sinal de Reserva
                </label>
                <span className="text-sm font-bold text-primary font-mono bg-primary/10 px-2.5 py-0.5 rounded-lg">
                  {config.percentualSinal}%
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={config.percentualSinal}
                onChange={(e) => setConfig({ ...config, percentualSinal: Number(e.target.value) })}
                className="w-full accent-primary cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-outline-variant">
                <span>10% (Sinal Leve)</span>
                <span>40% (Recomendado)</span>
                <span>100% (Integral)</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Ligar/Desligar Totem & Concorrência Redis */}
        <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-3xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-2xl">touch_app</span>
              </div>
              <div>
                <h3 className="font-bold text-sm text-primary uppercase tracking-wide">
                  Totem & Autoatendimento Ativo
                </h3>
                <p className="text-xs text-on-surface-variant">
                  Permite ligar ou desligar o acesso público ao totem no site e quiosques.
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.ativo}
                onChange={(e) => setConfig({ ...config, ativo: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-13 h-7 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[3px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary" />
            </label>
          </div>

          <div
            className={`p-4 rounded-2xl border text-xs leading-relaxed ${
              config.ativo
                ? 'bg-primary/5 border-primary/20 text-on-surface'
                : 'bg-amber-500/10 border-amber-500/25 text-amber-800 dark:text-amber-300'
            }`}
          >
            {config.ativo ? (
              <p>
                Totem <strong>Online</strong> e acessível na recepção e no botão do site. Visitantes podem navegar e marcar sessões.
              </p>
            ) : (
              <p>
                Totem <strong>Pausado</strong>. O sistema exibe um aviso acolhedor de manutenção orientando o cliente a falar com a recepção física.
              </p>
            )}
          </div>

          {/* Tempo de Lock no Redis */}
          <div className="space-y-2 pt-2 border-t border-outline-variant/15">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              Tempo de Bloqueio Temporário no Redis (Lock Slot)
            </label>
            <select
              value={config.tempoLockMinutos}
              onChange={(e) => setConfig({ ...config, tempoLockMinutos: Number(e.target.value) })}
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 text-xs font-semibold text-on-surface focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value={5}>5 minutos (Checkout Rápido)</option>
              <option value={10}>10 minutos (Recomendado para Spas)</option>
              <option value={15}>15 minutos (Maior tranquilidade no Pix)</option>
              <option value={20}>20 minutos (Relaxado)</option>
            </select>
            <p className="text-[10px] text-outline-variant">
              Tempo que o horário e a cabine ficam reservados para o cliente concluir o agendamento.
            </p>
          </div>
        </div>

        {/* Card 3: Mensagens e Instruções do Voucher */}
        <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-3xl p-6 shadow-sm space-y-4 md:col-span-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <div>
              <h3 className="font-bold text-sm text-primary uppercase tracking-wide">
                Instruções de Check-in no Voucher e WhatsApp
              </h3>
              <p className="text-xs text-on-surface-variant">
                Texto impresso nos vouchers digitais e disparado nas mensagens transacionais.
              </p>
            </div>
          </div>

          <div>
            <textarea
              rows={3}
              value={config.instrucoesCheckin || ''}
              onChange={(e) => setConfig({ ...config, instrucoesCheckin: e.target.value })}
              placeholder="Ex: Chegue com 15 minutos de antecedência na recepção para o ritual de boas-vindas..."
              className="w-full bg-surface-container-low border border-outline-variant/30 rounded-2xl p-3.5 text-xs text-on-surface focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-8 py-3 rounded-xl bg-primary text-on-primary hover:bg-primary-dim font-bold text-xs uppercase tracking-[0.15em] shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
