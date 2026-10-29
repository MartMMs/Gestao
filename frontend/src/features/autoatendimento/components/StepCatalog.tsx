import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Service, ConfiguracaoEmpresa } from '../../../types';
import { formatarReais } from '../utils/moeda';

interface StepCatalogProps {
  services: Service[];
  selectedServices?: Service[];
  onToggleService?: (service: Service) => void;
  onContinue: () => void;
  empresa?: ConfiguracaoEmpresa | null;
  // Compatibilidade regressiva
  selectedService?: Service | null;
  onSelectService?: (service: Service) => void;
}

export function StepCatalog({
  services,
  selectedServices = [],
  onToggleService,
  onContinue,
  empresa,
  selectedService = null,
  onSelectService,
}: StepCatalogProps) {
  const [activeCategory, setActiveCategory] = React.useState<string>('todas');
  const [searchTerm, setSearchTerm] = React.useState<string>('');

  // Unifica seleção múltipla com compatibilidade regressiva
  const activeSelectedList: Service[] = React.useMemo(() => {
    if (selectedServices && selectedServices.length > 0) {
      return selectedServices;
    }
    if (selectedService) {
      return [selectedService];
    }
    return [];
  }, [selectedServices, selectedService]);

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => {
      if (s.categoria && s.categoria.trim()) {
        set.add(s.categoria.trim());
      }
    });
    return ['todas', ...Array.from(set)];
  }, [services]);

  const filteredServices = React.useMemo(() => {
    return services.filter((s) => {
      const matchCategory =
        activeCategory === 'todas' ||
        (s.categoria && s.categoria.toLowerCase() === activeCategory.toLowerCase());
      const matchSearch =
        !searchTerm.trim() ||
        s.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.descricao && s.descricao.toLowerCase().includes(searchTerm.toLowerCase()));
      return matchCategory && matchSearch;
    });
  }, [services, activeCategory, searchTerm]);

  const termoServico = empresa?.termoServico || 'Produtos & Serviços';

  const handleCardClick = (service: Service) => {
    if (onToggleService) {
      onToggleService(service);
    } else if (onSelectService) {
      onSelectService(service);
    }
  };

  const duracaoTotal = React.useMemo(() => {
    return activeSelectedList.reduce((sum, s) => sum + (s.duracao || 60), 0);
  }, [activeSelectedList]);

  const valorTotal = React.useMemo(() => {
    return activeSelectedList.reduce((sum, s) => sum + s.preco, 0);
  }, [activeSelectedList]);

  const valorSinalTotal = React.useMemo(() => {
    return Math.round(valorTotal * 0.4 * 100) / 100;
  }, [valorTotal]);

  return (
    <div className="space-y-6">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
          Etapa 1 de 4 · Escolha: {termoServico}
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          Catálogo de {termoServico}
        </h2>
        <p className="text-sm text-on-surface-variant font-body">
          {empresa?.slogan || 'Selecione um ou mais produtos ou serviços para agendar seu horário com praticidade.'}
        </p>
      </div>

      {/* Busca e Categorias */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">
            search
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar produto ou serviço..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 text-xs sm:text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface"
          />
        </div>

        {categories.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 custom-scrollbar">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold tracking-wider uppercase whitespace-nowrap transition-all ${
                  activeCategory === cat
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'bg-surface-container-low text-on-surface-variant hover:text-primary border border-outline-variant/20'
                }`}
              >
                {cat === 'todas' ? 'Todas' : cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Indicador de Múltipla Escolha */}
      <div className="flex items-center justify-between px-1 text-xs text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-primary text-[17px]">checklist</span>
          <strong>Múltipla escolha permitida:</strong> Você pode combinar vários itens em um único agendamento contínuo.
        </span>
        {activeSelectedList.length > 0 && (
          <span className="text-primary font-bold text-xs bg-primary/10 px-2.5 py-0.5 rounded-full">
            {activeSelectedList.length} {activeSelectedList.length === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
        )}
      </div>

      {/* Grid de Cards de Produtos e Serviços */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredServices.map((service) => {
          const isSelected = activeSelectedList.some((s) => s.id === service.id);
          const valorSinal = Math.round(service.preco * 0.4 * 100) / 100;
          const tempoBuffer = service.tempoHigienizacaoMin || 15;

          return (
            <motion.div
              key={service.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.2 }}
              onClick={() => handleCardClick(service)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCardClick(service);
                }
              }}
              className={`p-5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between relative overflow-hidden ${
                isSelected
                  ? 'bg-primary/10 border-primary ring-2 ring-primary/40 shadow-md'
                  : 'bg-surface-container-lowest border-outline-variant/25 hover:border-primary/40 shadow-sm'
              }`}
            >
              {/* Badge visual de Selecionado no topo do Card */}
              {isSelected && (
                <div className="absolute top-0 right-0 bg-primary text-on-primary text-[10px] font-bold px-3 py-0.5 rounded-bl-xl uppercase tracking-wider flex items-center gap-1 shadow-xs">
                  <span className="material-symbols-outlined text-[13px]">check</span>
                  Adicionado
                </div>
              )}

              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-xs transition-colors ${
                    isSelected ? 'bg-primary text-on-primary' : 'bg-primary/10 border border-primary/20 text-primary'
                  }`}>
                    <span className="material-symbols-outlined text-2xl sm:text-3xl">
                      {service.icone || 'spa'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg sm:text-xl font-bold font-headline text-primary">
                      {formatarReais(service.preco)}
                    </span>
                    <p className="text-[10px] text-on-surface-variant font-medium">
                      Sinal de {formatarReais(valorSinal)}
                    </p>
                  </div>
                </div>

                <h3 className="font-bold text-base sm:text-lg text-on-surface mb-1">{service.nome}</h3>
                <p className="text-xs text-on-surface-variant font-body line-clamp-2 mb-3 leading-relaxed">
                  {service.descricao ||
                    'Experiência exclusiva com profissionais qualificados e atendimento de excelência.'}
                </p>
              </div>

              <div className="pt-3 border-t border-outline-variant/15 flex items-center justify-between">
                <div className="flex items-center gap-2 text-on-surface-variant text-xs">
                  <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[15px]">schedule</span>
                  </div>
                  <span className="font-semibold">{service.duracao || 60} min</span>
                  <span className="text-[10px] text-on-surface-variant/70">
                    (+{tempoBuffer}m preparo)
                  </span>
                </div>

                <span
                  className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-lg transition-colors flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {isSelected ? 'check_box' : 'add_box'}
                  </span>
                  {isSelected ? 'Adicionado' : 'Adicionar'}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Resumo Dinâmico dos Produtos Escolhidos */}
      <AnimatePresence>
        {activeSelectedList.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="p-3.5 sm:p-4 rounded-2xl bg-surface-container-low border border-primary/25 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">shopping_bag</span>
                Itens no seu agendamento ({activeSelectedList.length})
              </span>
              <span className="text-on-surface-variant">
                Duração somada: <strong className="text-primary font-bold">{duracaoTotal} min</strong>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {activeSelectedList.map((item) => (
                <div
                  key={item.id}
                  className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-xl text-xs font-medium"
                >
                  <span>{item.nome}</span>
                  <span className="text-[10px] opacity-75">({item.duracao || 60}m · {formatarReais(item.preco)})</span>
                  {onToggleService && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleService(item);
                      }}
                      className="w-4 h-4 rounded-full hover:bg-primary/20 flex items-center justify-center text-primary cursor-pointer ml-0.5"
                      title={`Remover ${item.nome}`}
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barra Inferior de Ação */}
      <div className="pt-4 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-on-surface-variant">
          {activeSelectedList.length > 0 ? (
            <span className="font-medium">
              Total: <strong className="text-primary text-sm font-bold">{formatarReais(valorTotal)}</strong> (
              Sinal de {formatarReais(valorSinalTotal)} · {duracaoTotal} min contínuos na agenda)
            </span>
          ) : (
            <span>Selecione um ou mais produtos ou serviços acima para prosseguir para a escolha do horário.</span>
          )}
        </div>

        <button
          type="button"
          disabled={activeSelectedList.length === 0}
          onClick={onContinue}
          className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all shadow-sm ${
            activeSelectedList.length > 0
              ? 'bg-primary text-on-primary hover:bg-primary-dim active:scale-[0.98]'
              : 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed opacity-60'
          }`}
        >
          <span>Escolher Horário {activeSelectedList.length > 1 ? `(${activeSelectedList.length})` : ''}</span>
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}
