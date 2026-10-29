import React, { useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { motion } from 'motion/react';
import { Service, ServiceEligibilityMode } from '../../../types';

interface SupervisorServicosTabProps {
  services: Service[];
  filteredServices: Service[];
  serviceSearchTerm: string;
  setServiceSearchTerm: (value: string) => void;
  editingServiceId: string | null;
  cancelServiceEdit: () => void;
  handleServiceSubmit: (e: React.FormEvent) => void;
  formatDuration: (minutes: number) => string;
  getEligibilitySummary: (service: Service) => string;
  onEditServiceCard: (service: Service) => void;
  onDeleteServiceCard: (serviceId: string) => unknown;
  // Quando o componente pai não tem diálogo próprio, a aba pede confirmação antes de excluir
  confirmarExclusao?: boolean;
  serviceIcons: string[];
  newServiceIcon: string;
  setNewServiceIcon: (value: string) => void;
  newServiceName: string;
  setNewServiceName: (value: string) => void;
  newServicePrice: string;
  setNewServicePrice: (value: string) => void;
  newServiceDuration: string;
  setNewServiceDuration: (value: string) => void;
  serviceEligibilityMode: ServiceEligibilityMode;
  setServiceEligibilityMode: (value: ServiceEligibilityMode) => void;
  newServiceCategoria: string;
  setNewServiceCategoria: (value: string) => void;
  newServiceTempoHigienizacao: string;
  setNewServiceTempoHigienizacao: (value: string) => void;
  newServiceComissao: string;
  setNewServiceComissao: (value: string) => void;
  serviceAllowedCargosInput: string;
  setServiceAllowedCargosInput: React.Dispatch<React.SetStateAction<string>>;
  serviceAllowedSkillsInput: string;
  setServiceAllowedSkillsInput: React.Dispatch<React.SetStateAction<string>>;
  serviceAllowedProfessionalsInput: string;
  setServiceAllowedProfessionalsInput: React.Dispatch<React.SetStateAction<string>>;
  availableCargos: string[];
  availableSkills: string[];
  availableProfessionals: string[];
  appendRuleToken: (currentValue: string, nextToken: string) => string;
  newServiceDescription: string;
  setNewServiceDescription: (value: string) => void;
}

export function SupervisorServicosTab({
  services,
  filteredServices,
  serviceSearchTerm,
  setServiceSearchTerm,
  editingServiceId,
  cancelServiceEdit,
  handleServiceSubmit,
  formatDuration,
  getEligibilitySummary,
  onEditServiceCard,
  onDeleteServiceCard,
  confirmarExclusao = false,
  serviceIcons,
  newServiceIcon,
  setNewServiceIcon,
  newServiceName,
  setNewServiceName,
  newServicePrice,
  setNewServicePrice,
  newServiceDuration,
  setNewServiceDuration,
  serviceEligibilityMode,
  setServiceEligibilityMode,
  newServiceCategoria,
  setNewServiceCategoria,
  newServiceTempoHigienizacao,
  setNewServiceTempoHigienizacao,
  newServiceComissao,
  setNewServiceComissao,
  serviceAllowedCargosInput,
  setServiceAllowedCargosInput,
  serviceAllowedSkillsInput,
  setServiceAllowedSkillsInput,
  serviceAllowedProfessionalsInput,
  setServiceAllowedProfessionalsInput,
  availableCargos,
  availableSkills,
  availableProfessionals,
  appendRuleToken,
  newServiceDescription,
  setNewServiceDescription,
}: SupervisorServicosTabProps) {
  const [servicoParaExcluir, setServicoParaExcluir] = useState<Service | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExclusao, setErroExclusao] = useState<string | null>(null);

  const confirmarExclusaoServico = async () => {
    if (!servicoParaExcluir) return;
    setExcluindo(true);
    setErroExclusao(null);
    try {
      await onDeleteServiceCard(servicoParaExcluir.id);
      setServicoParaExcluir(null);
    } catch (error) {
      setErroExclusao(error instanceof Error ? error.message : 'Não foi possível excluir o serviço.');
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
      <div className="xl:col-span-7 space-y-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-4 border-b border-outline-variant/20 pb-4">
          <div>
            <h3 className="text-2xl font-headline text-primary">Menu de Serviços</h3>
            <p className="text-sm text-on-surface-variant">Gerencie tratamentos, durações, comissões e valores.</p>
            <p className="mt-1 text-xs text-on-surface-variant/80">
              {filteredServices.length} de {services.length} serviços visíveis
            </p>
          </div>
          <div className="relative w-full md:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">search</span>
            <input
              type="text"
              placeholder="Buscar serviço..."
              value={serviceSearchTerm}
              onChange={e => setServiceSearchTerm(e.target.value)}
              aria-label="Buscar serviço"
              className="w-full pl-10 pr-10 py-2 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface"
            />
            {serviceSearchTerm && (
              <button
                type="button"
                onClick={() => setServiceSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                aria-label="Limpar busca de serviços"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {filteredServices.map((srv) => {
            const eligibilityModeLabel = srv.modoElegibilidade === 'cargo'
              ? 'Por cargo'
              : srv.modoElegibilidade === 'habilidade'
                ? 'Por habilidade'
                : srv.modoElegibilidade === 'profissional'
                  ? 'Por profissional'
                  : 'Livre';

            return (
              <div 
                key={srv.id} 
                onClick={() => onEditServiceCard(srv)}
                className="bg-surface-container-lowest p-5 rounded-3xl flex flex-col gap-4 transition-all hover:bg-surface-container-low hover:border-primary/30 group relative overflow-hidden border border-outline-variant/10 shadow-sm cursor-pointer"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary/80"></div>
                <div className="flex items-center gap-4 pl-2 min-w-0">
                  <div className="w-12 h-12 bg-primary-container/20 rounded-full flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined">{srv.icone || 'spa'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-headline text-lg text-on-surface truncate">{srv.nome}</h4>
                      {srv.categoria && <span className="shrink-0 text-[9px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">{srv.categoria}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-sm text-on-surface-variant">
                      <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs">
                        <span className="material-symbols-outlined text-[14px]">schedule</span> 
                        {formatDuration(Number(srv.duracao || 60))}
                        {srv.tempoHigienizacaoMin ? <span className="text-[10px] opacity-70 ml-1">+ {srv.tempoHigienizacaoMin}m prep</span> : ''}
                      </span>
                      <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs">
                        <span className="material-symbols-outlined text-[14px]">payments</span> R$ {Number(srv.preco).toFixed(2)}
                      </span>
                      {Boolean(srv.comissaoPercentual) && Number(srv.comissaoPercentual) > 0 && (
                        <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs text-secondary">
                          <span className="material-symbols-outlined text-[14px]">percent</span> {srv.comissaoPercentual}%
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                        <span className="material-symbols-outlined text-[14px]">verified_user</span>
                        {eligibilityModeLabel}
                      </span>
                    </div>
                    {srv.descricao && (
                      <p className="text-xs text-on-surface-variant mt-2 line-clamp-2 italic">
                        {srv.descricao}
                      </p>
                    )}
                    <p className="text-[10px] text-on-surface-variant mt-1 line-clamp-2">
                      {getEligibilitySummary(srv)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end border-t border-outline-variant/10 pt-3 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <button onClick={(e) => { e.stopPropagation(); onEditServiceCard(srv); }} className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full transition-colors" title="Editar"><span className="material-symbols-outlined text-[22px]">edit</span></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirmarExclusao) setServicoParaExcluir(srv); else onDeleteServiceCard(srv.id); }} className="p-2 text-on-surface-variant hover:bg-error-container/20 hover:text-error rounded-full transition-colors" title="Excluir"><span className="material-symbols-outlined text-[22px]">delete</span></button>
                </div>
              </div>
            );
          })}
          {filteredServices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-surface-container-lowest border border-outline-variant/20 rounded-3xl border-dashed">
              <div className="w-16 h-16 bg-primary-container/30 text-primary rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl">spa</span>
              </div>
              <h4 className="text-lg font-headline text-on-surface mb-2">Seu menu de serviços está vazio.</h4>
              <p className="text-sm text-on-surface-variant max-w-xs">Adicione ou busque seu primeiro tratamento utilizando o painel.</p>
            </div>
          )}
        </div>
      </div>

      <div className="xl:col-span-5 bg-surface-container-low p-8 rounded-3xl border border-outline-variant/20 h-fit sticky top-24">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-headline text-primary flex items-center gap-2"><span className="material-symbols-outlined">{editingServiceId ? 'edit' : 'add_circle'}</span> {editingServiceId ? 'Editar Serviço' : 'Adicionar Novo Serviço'}</h3>
          {editingServiceId && <button onClick={cancelServiceEdit} className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors">Cancelar</button>}
        </div>
        <form onSubmit={handleServiceSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Ícone de Identificação</label>
            <div className="flex gap-2 mb-4">
              {serviceIcons.map(icon => (
                <button key={icon} type="button" onClick={() => setNewServiceIcon(icon)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${newServiceIcon === icon ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 hover:border-primary/50'}`}>
                  <span className="material-symbols-outlined text-[20px]">{icon}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Nome do Tratamento</label>
              <input required type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all" placeholder="Ex: Massagem com Pedras" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Categoria do Serviço</label>
              <select value={newServiceCategoria} onChange={e => setNewServiceCategoria(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all text-on-surface">
                <option value="">Sem categoria</option>
                <option value="Massagens">Massagens</option>
                <option value="Estética Facial">Estética Facial</option>
                <option value="Estética Corporal">Estética Corporal</option>
                <option value="Banhos e Ofurô">Banhos e Ofurô</option>
                <option value="Day Spa">Day Spa</option>
                <option value="Terapias Holísticas">Terapias Holísticas</option>
                <option value="Outros">Outros</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Preço (R$)</label>
              <input required type="number" step="0.01" min="0" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all" placeholder="Ex: 150.00" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Comissão (%) - Opcional</label>
              <input type="number" step="0.1" min="0" max="100" value={newServiceComissao} onChange={e => setNewServiceComissao(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all" placeholder="Deixe em branco se não houver" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Duração (Min)</label>
              <input required type="number" min="5" step="5" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all" placeholder="Ex: 60" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Tempo de Preparo (Min)</label>
              <input type="number" min="0" step="5" value={newServiceTempoHigienizacao} onChange={e => setNewServiceTempoHigienizacao(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all" placeholder="Ex: 15" title="Tempo necessário para preparo e higienização da sala antes ou depois" />
            </div>
          </div>
          <div className="space-y-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4">
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Elegibilidade do Serviço</label>
              <select
                value={serviceEligibilityMode}
                onChange={(e) => setServiceEligibilityMode(e.target.value as ServiceEligibilityMode)}
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm"
              >
                <option value="livre">Livre (qualquer profissional)</option>
                <option value="cargo">Restrito por cargo</option>
                <option value="habilidade">Restrito por habilidade</option>
                <option value="profissional">Restrito por profissional específico</option>
              </select>
              <p className="text-[10px] text-on-surface-variant mt-2">
                Defina quem pode executar este serviço. No modo livre, todos os profissionais ficam disponíveis.
              </p>
            </div>

            {serviceEligibilityMode === 'cargo' && (
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Cargos Permitidos</label>
                <input
                  type="text"
                  value={serviceAllowedCargosInput}
                  onChange={(e) => setServiceAllowedCargosInput(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm"
                  placeholder="Ex: Massoterapeuta, Esteticista"
                />
                {availableCargos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableCargos.slice(0, 10).map((cargo) => (
                      <button
                        key={cargo}
                        type="button"
                        onClick={() => setServiceAllowedCargosInput((prev) => appendRuleToken(prev, cargo))}
                        className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-widest hover:bg-primary/20"
                      >
                        + {cargo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {serviceEligibilityMode === 'habilidade' && (
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Habilidades Permitidas</label>
                <input
                  type="text"
                  value={serviceAllowedSkillsInput}
                  onChange={(e) => setServiceAllowedSkillsInput(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm"
                  placeholder="Ex: Drenagem, Microagulhamento"
                />
                {availableSkills.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableSkills.slice(0, 12).map((skill) => (
                      <button
                        key={skill}
                        type="button"
                        onClick={() => setServiceAllowedSkillsInput((prev) => appendRuleToken(prev, skill))}
                        className="text-[10px] px-2 py-1 rounded-full bg-secondary-container/60 text-on-secondary-container font-bold uppercase tracking-widest hover:bg-secondary-container"
                      >
                        + {skill}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {serviceEligibilityMode === 'profissional' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Profissionais Habilitados</label>
                <input
                  type="text"
                  value={serviceAllowedProfessionalsInput}
                  onChange={(e) => setServiceAllowedProfessionalsInput(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm"
                  placeholder="Ex: Ana Luiza, Marcos"
                />
                {availableProfessionals.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {availableProfessionals.map((prof) => (
                      <button
                        key={prof}
                        type="button"
                        onClick={() => setServiceAllowedProfessionalsInput((prev) => appendRuleToken(prev, prof))}
                        className="text-[10px] px-2 py-1 rounded-full bg-tertiary-container/60 text-on-tertiary-container font-bold uppercase tracking-widest hover:bg-tertiary-container"
                      >
                        + {prof.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Detalhes / Produtos Utilizados (Opcional)</label>
            <textarea value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm transition-all resize-none min-h-20" placeholder="Ex: Utiliza óleos essenciais relaxantes, pedras aquecidas e toalhas quentes..." />
          </div>
          <button type="submit" className="w-full mt-4 bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-all active:scale-[0.98]">{editingServiceId ? 'Salvar Alterações' : 'Salvar Serviço'}</button>
        </form>
      </div>
      <ConfirmDialog
        open={Boolean(servicoParaExcluir)}
        title={`Excluir o serviço ${servicoParaExcluir?.nome ?? ''}?`}
        description={erroExclusao ?? 'O serviço sairá do catálogo. Serviços com agendamentos vinculados não podem ser excluídos.'}
        confirmLabel="Sim, excluir"
        confirmingLabel="Excluindo..."
        cancelLabel="Manter serviço"
        icon="delete"
        isSubmitting={excluindo}
        onClose={() => { setServicoParaExcluir(null); setErroExclusao(null); }}
        onConfirm={confirmarExclusaoServico}
      />
    </motion.div>
  );
}
