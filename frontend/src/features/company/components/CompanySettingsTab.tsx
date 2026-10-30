import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ConfiguracaoEmpresa } from '../../../types';
import { useCompanyConfig, useUpdateCompanyConfig } from '../../../api';

interface PresetConfig {
  id: string;
  nome: string;
  icone: string;
  segmento: string;
  exemploEmpresa: string;
  slogan: string;
  termoAtendimento: string;
  termoProfissional: string;
  termoEspaco: string;
  termoServico: string;
  cor: string;
}

const PRESETS: PresetConfig[] = [
  {
    id: 'geral',
    nome: 'Geral & Atendimentos',
    icone: 'storefront',
    segmento: 'geral',
    exemploEmpresa: 'OmniGestão Atendimentos',
    slogan: 'Agendamentos inteligentes e gestão operacional com alta eficiência.',
    termoAtendimento: 'Atendimento',
    termoProfissional: 'Profissional',
    termoEspaco: 'Sala / Espaço',
    termoServico: 'Serviço',
    cor: 'from-blue-600/20 to-indigo-600/10 text-blue-500 border-blue-500/30',
  },
  {
    id: 'beleza_barbearia',
    nome: 'Salão de Beleza & Barbearia',
    icone: 'content_cut',
    segmento: 'beleza_barbearia',
    exemploEmpresa: 'Studio & Barbearia Prime',
    slogan: 'Cortes exclusivos, barba e estilo com comodidade para seus clientes.',
    termoAtendimento: 'Horário / Corte',
    termoProfissional: 'Barbeiro / Cabeleireiro',
    termoEspaco: 'Cadeira / Bancada',
    termoServico: 'Procedimento / Corte',
    cor: 'from-amber-600/20 to-orange-600/10 text-amber-500 border-amber-500/30',
  },
  {
    id: 'clinica_saude',
    nome: 'Clínica Médica & Saúde',
    icone: 'medical_services',
    segmento: 'clinica_saude',
    exemploEmpresa: 'Clínica Integrada de Saúde',
    slogan: 'Cuidado humanizado e pontualidade no atendimento aos seus pacientes.',
    termoAtendimento: 'Consulta',
    termoProfissional: 'Médico / Especialista',
    termoEspaco: 'Consultório',
    termoServico: 'Consulta / Exame',
    cor: 'from-emerald-600/20 to-teal-600/10 text-emerald-500 border-emerald-500/30',
  },
  {
    id: 'spa_bemestar',
    nome: 'Spa & Terapias de Bem-Estar',
    icone: 'spa',
    segmento: 'spa_bemestar',
    exemploEmpresa: 'Serenidade Spa & Resort',
    slogan: 'Experiências sensoriais de equilíbrio, relaxamento e autocuidado.',
    termoAtendimento: 'Sessão',
    termoProfissional: 'Terapeuta',
    termoEspaco: 'Cabine',
    termoServico: 'Terapia / Ritual',
    cor: 'from-teal-600/20 to-cyan-600/10 text-teal-400 border-teal-500/30',
  },
  {
    id: 'estudio_fitness',
    nome: 'Estúdio, Personal & Pilates',
    icone: 'fitness_center',
    segmento: 'estudio_fitness',
    exemploEmpresa: 'Flow Studio & Bem-Estar',
    slogan: 'Aulas individuais e em grupo com acompanhamento dedicado.',
    termoAtendimento: 'Aula / Treino',
    termoProfissional: 'Instrutor / Personal',
    termoEspaco: 'Sala / Box',
    termoServico: 'Modalidade / Aula',
    cor: 'from-purple-600/20 to-pink-600/10 text-purple-400 border-purple-500/30',
  },
];

const AVAILABLE_ICONS = [
  'storefront',
  'content_cut',
  'medical_services',
  'spa',
  'fitness_center',
  'calendar_month',
  'handshake',
  'apartment',
  'diamond',
  'local_hospital',
];

interface CompanySettingsTabProps {
  token: string | null;
}

export function CompanySettingsTab({ token }: CompanySettingsTabProps) {
  const { data: config, isLoading } = useCompanyConfig(token);
  const updateMutation = useUpdateCompanyConfig(token);

  const [form, setForm] = useState<Partial<ConfiguracaoEmpresa>>({
    nomeEmpresa: 'OmniGestão - Atendimentos & Agendamentos',
    segmento: 'geral',
    slogan: 'Gestão inteligente e experiência de excelência para seus clientes.',
    icone: 'storefront',
    termoAtendimento: 'Atendimento',
    termoProfissional: 'Profissional',
    termoEspaco: 'Sala / Espaço',
    termoServico: 'Serviço',
    telefoneContato: '(11) 99999-8888',
    emailContato: 'contato@empresa.com',
    endereco: 'Av. Principal, 1000 - Centro',
    corTemaPrimaria: '#0f766e',
  });

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setForm(config);
    }
  }, [config]);

  const applyPreset = (preset: PresetConfig) => {
    setForm((prev) => ({
      ...prev,
      nomeEmpresa: preset.exemploEmpresa,
      segmento: preset.segmento,
      slogan: preset.slogan,
      icone: preset.icone,
      termoAtendimento: preset.termoAtendimento,
      termoProfissional: preset.termoProfissional,
      termoEspaco: preset.termoEspaco,
      termoServico: preset.termoServico,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      await updateMutation.mutateAsync(form);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar as configurações.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant">
        <span className="material-symbols-outlined text-4xl animate-spin text-primary">progress_activity</span>
        <p className="mt-2 text-sm">Carregando configurações da empresa...</p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
            Painel Administrativo Mestre
          </span>
          <h2 className="text-2xl sm:text-3xl font-headline text-on-surface mt-2">
            Perfil da Empresa & Multi-Segmento
          </h2>
          <p className="text-sm text-on-surface-variant font-body">
            Adapte o sistema para qualquer modelo de negócio (Barbearias, Clínicas, Spas, Estúdios ou Serviços Gerais).
          </p>
        </div>

        {saveSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 bg-primary/15 text-primary border border-primary/30 px-4 py-2 rounded-xl text-xs font-bold"
          >
            <span className="material-symbols-outlined text-lg">check_circle</span>
            Configurações salvas e aplicadas em tempo real!
          </motion.div>
        )}
      </div>

      {/* 1. Presets Rápidos com 1 Clique */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-xl">auto_fix_high</span>
          <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface">
            Modelos de Negócio Prontos (Presets em 1 Clique)
          </h3>
        </div>
        <p className="text-xs text-on-surface-variant">
          Clique em um dos segmentos abaixo para preencher automaticamente as terminologias e configurações ideais:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {PRESETS.map((preset) => {
            const isCurrent = form.segmento === preset.segmento;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden group flex flex-col justify-between ${
                  isCurrent
                    ? 'bg-surface-container-high border-primary ring-2 ring-primary/40 shadow-md'
                    : 'bg-surface-container-low border-outline-variant/20 hover:border-outline-variant/50 hover:bg-surface-container'
                }`}
              >
                <div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-gradient-to-br ${preset.cor} border`}>
                    <span className="material-symbols-outlined text-[20px]">{preset.icone}</span>
                  </div>
                  <h4 className="font-bold text-xs text-on-surface leading-tight mb-1">{preset.nome}</h4>
                  <p className="text-[10px] text-on-surface-variant line-clamp-2">{preset.slogan}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-outline-variant/15 text-[10px] text-primary font-bold">
                  {preset.termoProfissional} · {preset.termoEspaco}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Formulário de Configuração Detalhado */}
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Coluna Esquerda: Dados Principais da Empresa */}
        <div className="lg:col-span-7 bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-outline-variant/20 pb-3">
            <span className="material-symbols-outlined text-primary">domain</span>
            <h3 className="font-bold text-base text-on-surface">Identidade da Empresa</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                Nome da Empresa / Estabelecimento
              </label>
              <input
                type="text"
                required
                value={form.nomeEmpresa || ''}
                onChange={(e) => setForm({ ...form, nomeEmpresa: e.target.value })}
                placeholder="Ex: Studio Alpha, Barbearia Silva, Clínica Vida"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                Slogan / Descrição Curta
              </label>
              <input
                type="text"
                value={form.slogan || ''}
                onChange={(e) => setForm({ ...form, slogan: e.target.value })}
                placeholder="Ex: Cuidado, excelência e bem-estar para o seu dia a dia"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                Telefone / WhatsApp de Atendimento
              </label>
              <input
                type="text"
                value={form.telefoneContato || ''}
                onChange={(e) => setForm({ ...form, telefoneContato: e.target.value })}
                placeholder="(11) 99999-8888"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                E-mail Institucional
              </label>
              <input
                type="email"
                value={form.emailContato || ''}
                onChange={(e) => setForm({ ...form, emailContato: e.target.value })}
                placeholder="contato@empresa.com"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                Endereço Físico (exibido nos Vouchers e Confirmações)
              </label>
              <input
                type="text"
                value={form.endereco || ''}
                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                placeholder="Ex: Rua das Flores, 120 - Jardins, São Paulo - SP"
                className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm text-on-surface focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Seletor de Ícone */}
          <div className="pt-3 border-t border-outline-variant/20">
            <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">
              Ícone do Sistema
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_ICONS.map((icon) => {
                const isSelected = form.icone === icon;
                return (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setForm({ ...form, icone: icon })}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95 ${
                      isSelected
                        ? 'bg-primary text-on-primary ring-2 ring-primary/40 shadow-sm scale-105'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-primary hover:border-primary/40 border border-outline-variant/25'
                    }`}
                  >
                    <span className="material-symbols-outlined text-2xl">{icon}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Coluna Direita: Terminologia Customizada e Preview */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-outline-variant/20 pb-3">
              <span className="material-symbols-outlined text-primary">translate</span>
              <h3 className="font-bold text-base text-on-surface">Terminologia no Sistema</h3>
            </div>
            <p className="text-xs text-on-surface-variant">
              Como esses termos devem aparecer na barra superior, no Totem e nos comprovantes:
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                  Termo para o Profissional
                </label>
                <input
                  type="text"
                  value={form.termoProfissional || ''}
                  onChange={(e) => setForm({ ...form, termoProfissional: e.target.value })}
                  placeholder="Ex: Profissional, Barbeiro, Médico, Terapeuta"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-on-surface"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                  Termo para o Espaço / Sala
                </label>
                <input
                  type="text"
                  value={form.termoEspaco || ''}
                  onChange={(e) => setForm({ ...form, termoEspaco: e.target.value })}
                  placeholder="Ex: Sala, Consultório, Cabine, Cadeira"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-on-surface"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                  Termo para o Serviço / Item
                </label>
                <input
                  type="text"
                  value={form.termoServico || ''}
                  onChange={(e) => setForm({ ...form, termoServico: e.target.value })}
                  placeholder="Ex: Serviço, Procedimento, Tratamento, Corte"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-on-surface"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">
                  Termo para o Atendimento / Agendamento
                </label>
                <input
                  type="text"
                  value={form.termoAtendimento || ''}
                  onChange={(e) => setForm({ ...form, termoAtendimento: e.target.value })}
                  placeholder="Ex: Atendimento, Consulta, Sessão, Reserva"
                  className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 text-xs sm:text-sm text-on-surface"
                />
              </div>
            </div>
          </div>

          {/* Comissão é opcional: desligada, o campo some do cadastro de serviços */}
          <label className="flex items-start gap-3 bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 cursor-pointer">
            <input
              type="checkbox"
              checked={form.usarComissao !== false}
              onChange={(e) => setForm({ ...form, usarComissao: e.target.checked })}
              className="mt-1 accent-primary"
            />
            <span>
              <span className="block text-sm font-bold text-on-surface">Trabalhar com comissão dos profissionais</span>
              <span className="block text-xs text-on-surface-variant">Desligado, o percentual de comissão deixa de aparecer nos serviços.</span>
            </span>
          </label>

          {saveError && (
            <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{saveError}</p>
          )}

          {/* Cartão de Pré-visualização do Header */}
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-5 space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/70">
              Pré-visualização no Cabeçalho
            </span>
            <div className="flex items-center gap-3 bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/20">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                <span className="material-symbols-outlined text-[22px]">{form.icone || 'storefront'}</span>
              </div>
              <div>
                <h4 className="font-headline font-bold text-sm text-on-surface">
                  {form.nomeEmpresa || 'Nome da Sua Empresa'}
                </h4>
                <p className="text-[11px] text-on-surface-variant font-body">
                  {form.slogan || 'Slogan ou subtítulo configurado'}
                </p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="w-full py-3.5 bg-primary text-on-primary rounded-xl font-bold text-sm uppercase tracking-wider hover:bg-primary/90 transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {updateMutation.isPending ? (
              <>
                <span className="material-symbols-outlined animate-spin text-lg">progress_activity</span>
                Salvando alterações...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">save</span>
                Salvar Configurações da Empresa
              </>
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
