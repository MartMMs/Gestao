import React, { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { motion } from 'motion/react';
import { Service, ServiceEligibilityMode } from '../../../types';
import { isApiError, useCompanyConfig, useToggleServiceActive } from '../../../api';
import { useAuth } from '../../../AuthContext';

const CATEGORIAS_SUGERIDAS = ['Atendimento', 'Consulta', 'Avaliação', 'Procedimento', 'Pacote', 'Outros'];
// Rótulo envolvendo o campo: o leitor de tela anuncia o nome de cada campo sem precisar de id
const ROTULO = 'block text-xs font-bold text-on-surface-variant';
const CAMPO = 'mt-1 w-full h-11 px-3 bg-surface-container-lowest border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none';
const LEGENDA = 'text-sm font-bold text-on-surface mb-1';

interface SupervisorServicosTabProps {
  services: Service[];
  filteredServices: Service[];
  serviceSearchTerm: string;
  setServiceSearchTerm: (value: string) => void;
  editingServiceId: string | null;
  cancelServiceEdit: () => void;
  handleServiceSubmit: (e: React.FormEvent) => void | Promise<void>;
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
  // Clicar num serviço leva ao formulário (no celular ele fica abaixo da lista) já no campo nome
  const formRef = useRef<HTMLElement>(null);
  // Um envio por vez: o duplo clique em salvar mandava dois PUT/POST (o ref segura antes do próximo render)
  const [salvandoServico, setSalvandoServico] = useState(false);
  const salvandoRef = useRef(false);
  const enviarServico = async (event: React.FormEvent) => {
    event.preventDefault();
    if (salvandoRef.current) return;
    salvandoRef.current = true;
    setSalvandoServico(true);
    try {
      await handleServiceSubmit(event);
    } finally {
      salvandoRef.current = false;
      setSalvandoServico(false);
    }
  };
  useEffect(() => {
    if (!editingServiceId || !formRef.current) return;
    formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formRef.current.querySelector('input')?.focus({ preventScroll: true });
  }, [editingServiceId]);
  const { token, currentUser } = useAuth();
  // Comissão é definida só pelo admin (o servidor recusa a alteração vinda de outro papel)
  const podeEditarComissao = currentUser?.role === 'admin';
  const { data: empresa } = useCompanyConfig(token);
  const usarComissao = empresa?.usarComissao !== false;
  const alternarAtivo = useToggleServiceActive(token);
  const [avisoAtivo, setAvisoAtivo] = useState<string | null>(null);
  // Última troca feita, para o "Desfazer" do aviso (o botão de olho age com um clique)
  const [ultimaTroca, setUltimaTroca] = useState<{ id: string; ativo: boolean } | null>(null);
  const aplicarAtivo = async (id: string, ativo: boolean, desfazendo = false) => {
    try {
      const resposta = await alternarAtivo.mutateAsync({ id, ativo }) as { mensagem?: string };
      setAvisoAtivo(desfazendo ? 'Alteração desfeita.' : resposta?.mensagem ?? null);
      setUltimaTroca(desfazendo ? null : { id, ativo });
    } catch (error) {
      setAvisoAtivo(isApiError(error) ? error.message : 'Não foi possível alterar o serviço.');
      setUltimaTroca(null);
    }
  };
  const trocarAtivo = (srv: Service) => aplicarAtivo(srv.id, srv.ativo === false);
  // Categorias livres: as sugeridas mais as que já existem nos serviços
  const categorias = Array.from(new Set([...CATEGORIAS_SUGERIDAS, ...services.map((s) => s.categoria).filter((c): c is string => Boolean(c))]));
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

  // Campo da regra "quem pode atender" (cargo, habilidade ou profissional); nenhum no modo livre
  const regra = serviceEligibilityMode === 'livre' ? null : {
    cargo: { rotulo: 'Cargos', valor: serviceAllowedCargosInput, alterar: setServiceAllowedCargosInput, opcoes: availableCargos.slice(0, 10), exemplo: 'Ex.: Atendente, Técnico' },
    habilidade: { rotulo: 'Habilidades', valor: serviceAllowedSkillsInput, alterar: setServiceAllowedSkillsInput, opcoes: availableSkills.slice(0, 12), exemplo: 'Ex.: Drenagem, Microagulhamento' },
    profissional: { rotulo: 'Profissionais', valor: serviceAllowedProfessionalsInput, alterar: setServiceAllowedProfessionalsInput, opcoes: availableProfessionals, exemplo: 'Ex.: Ana Luiza, Marcos' },
  }[serviceEligibilityMode];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
      <div className="xl:col-span-7 space-y-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-4 border-b border-outline-variant/20 pb-4">
          <div>
            <h3 className="text-2xl font-headline text-primary">Menu de Serviços</h3>
            <p className="text-sm text-on-surface-variant">Gerencie tratamentos, durações, comissões e valores.</p>
            <p className="mt-1 text-xs text-on-surface-variant/80">
              {filteredServices.length} de {services.length} serviços · {services.filter((s) => s.ativo === false).length} fora de linha
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

        {avisoAtivo && (
          <div role="status" className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-on-surface flex justify-between gap-2">
            <span>{avisoAtivo}</span>
            <span className="flex items-center gap-3 shrink-0">
              {ultimaTroca && (
                <button type="button" disabled={alternarAtivo.isPending} onClick={() => aplicarAtivo(ultimaTroca.id, !ultimaTroca.ativo, true)} className="font-bold uppercase tracking-wide text-primary">
                  Desfazer
                </button>
              )}
              <button type="button" onClick={() => { setAvisoAtivo(null); setUltimaTroca(null); }} aria-label="Fechar aviso" className="text-on-surface-variant">✕</button>
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 gap-4">
          {/* Fora de linha vão para o fim da lista */}
          {[...filteredServices].sort((a, b) => Number(a.ativo === false) - Number(b.ativo === false)).map((srv) => {
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
                className={`bg-surface-container-lowest p-5 rounded-3xl flex flex-col gap-4 transition-all ${srv.ativo === false ? 'opacity-60' : ''} hover:bg-surface-container-low hover:border-primary/30 group relative overflow-hidden border border-outline-variant/10 shadow-sm cursor-pointer`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-primary/80"></div>
                <div className="flex items-center gap-4 pl-2 min-w-0">
                  <div className="w-12 h-12 bg-primary-container/20 rounded-full flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined">{srv.icone || 'design_services'}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="font-headline text-lg text-on-surface truncate">{srv.nome}</h4>
                      {srv.ativo === false && <span className="shrink-0 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant bg-surface-container px-2 py-1 rounded-full">Fora de linha</span>}
                      {srv.categoria && <span className="shrink-0 text-[10px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">{srv.categoria}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-sm text-on-surface-variant">
                      <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs">
                        <span className="material-symbols-outlined text-[14px]">schedule</span> 
                        {formatDuration(Number(srv.duracao || 60))}
                        {srv.tempoHigienizacaoMin ? <span className="text-[11px] opacity-70 ml-1">+ {srv.tempoHigienizacaoMin}m prep</span> : ''}
                      </span>
                      <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs">
                        <span className="material-symbols-outlined text-[14px]">payments</span> R$ {Number(srv.preco).toFixed(2)}
                      </span>
                      {usarComissao && Boolean(srv.comissaoPercentual) && Number(srv.comissaoPercentual) > 0 && (
                        <span className="flex items-center gap-1 shrink-0 bg-surface-container px-2 py-1 rounded-lg text-xs text-secondary">
                          <span className="material-symbols-outlined text-[14px]">percent</span> {srv.comissaoPercentual}%
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
                        <span className="material-symbols-outlined text-[14px]">verified_user</span>
                        {eligibilityModeLabel}
                      </span>
                    </div>
                    {srv.descricao && (
                      <p className="text-xs text-on-surface-variant mt-2 line-clamp-2 italic">
                        {srv.descricao}
                      </p>
                    )}
                    <p className="text-[11px] text-on-surface-variant mt-1 line-clamp-2">
                      {getEligibilitySummary(srv)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 justify-end border-t border-outline-variant/10 pt-3 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <button onClick={(e) => { e.stopPropagation(); onEditServiceCard(srv); }} className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full transition-colors" title="Editar" aria-label={`Editar ${srv.nome}`}><span className="material-symbols-outlined text-[22px]" aria-hidden="true">edit</span></button>
                  <button onClick={(e) => { e.stopPropagation(); trocarAtivo(srv); }} disabled={alternarAtivo.isPending} className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full transition-colors" title={srv.ativo === false ? 'Voltar ao catálogo' : 'Tirar de linha (some do totem e de novos agendamentos)'} aria-label={srv.ativo === false ? `Voltar ${srv.nome} ao catálogo` : `Tirar ${srv.nome} de linha`}><span className="material-symbols-outlined text-[22px]" aria-hidden="true">{srv.ativo === false ? 'visibility' : 'visibility_off'}</span></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirmarExclusao) setServicoParaExcluir(srv); else onDeleteServiceCard(srv.id); }} className="p-2 text-on-surface-variant hover:bg-error-container/20 hover:text-error rounded-full transition-colors" title="Excluir" aria-label={`Excluir ${srv.nome}`}><span className="material-symbols-outlined text-[22px]" aria-hidden="true">delete</span></button>
                </div>
              </div>
            );
          })}
          {filteredServices.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-surface-container-lowest border border-outline-variant/20 rounded-3xl border-dashed">
              <div className="w-16 h-16 bg-primary-container/30 text-primary rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl">design_services</span>
              </div>
              <h4 className="text-lg font-headline text-on-surface mb-2">Seu menu de serviços está vazio.</h4>
              <p className="text-sm text-on-surface-variant max-w-xs">Adicione ou busque seu primeiro tratamento utilizando o painel.</p>
            </div>
          )}
        </div>
      </div>

      <section ref={formRef} aria-labelledby="form-servico-titulo" className="xl:col-span-5 bg-surface-container-low p-6 rounded-3xl border border-outline-variant/20 h-fit xl:sticky xl:top-24">
        <h3 id="form-servico-titulo" className="text-lg font-headline text-on-surface mb-5">{editingServiceId ? 'Editar serviço' : 'Novo serviço'}</h3>
        <form onSubmit={enviarServico} className="space-y-6">
          <fieldset className="space-y-4">
            <legend className={LEGENDA}>1. Dados básicos</legend>
            <label className={ROTULO}>
              Nome <span className="text-error" aria-hidden="true">*</span>
              <input required type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} className={CAMPO} placeholder="Ex.: Avaliação inicial" />
            </label>
            <label className={ROTULO}>
              Categoria
              <input list="categorias-servico" maxLength={60} value={newServiceCategoria} onChange={e => setNewServiceCategoria(e.target.value)} placeholder="Escolha ou digite uma nova" className={CAMPO} />
              <datalist id="categorias-servico">
                {categorias.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <div>
              <p className={ROTULO} id="icone-servico">Ícone</p>
              <div role="radiogroup" aria-labelledby="icone-servico" className="mt-1 flex flex-wrap gap-2">
                {serviceIcons.map(icon => (
                  <button key={icon} type="button" role="radio" aria-checked={newServiceIcon === icon} aria-label={icon} onClick={() => setNewServiceIcon(icon)} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${newServiceIcon === icon ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 hover:border-primary/50'}`}>
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{icon}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className={ROTULO}>
              Descrição <span className="font-normal text-on-surface-variant">(opcional: aparece no totem)</span>
              <textarea value={newServiceDescription} onChange={e => setNewServiceDescription(e.target.value)} rows={2} className={`${CAMPO} h-auto py-2 resize-none`} placeholder="Ex.: Utiliza óleos essenciais e toalhas quentes" />
            </label>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className={LEGENDA}>2. Preço e tempo</legend>
            <div className="grid grid-cols-2 gap-3">
              <label className={ROTULO}>
                Preço (R$) <span className="text-error" aria-hidden="true">*</span>
                <input required type="number" inputMode="decimal" step="0.01" min="0" value={newServicePrice} onChange={e => setNewServicePrice(e.target.value)} className={CAMPO} placeholder="150,00" />
              </label>
              {usarComissao && (
                <label className={ROTULO}>
                  Comissão (%)
                  <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={newServiceComissao} onChange={e => setNewServiceComissao(e.target.value)} disabled={!podeEditarComissao} className={`${CAMPO} disabled:opacity-60`} placeholder={podeEditarComissao ? 'Sem comissão' : '—'} />
                  {!podeEditarComissao && <span className="block mt-1 text-[11px] font-normal text-on-surface-variant">Definida pelo administrador.</span>}
                </label>
              )}
              <label className={ROTULO}>
                Duração (min) <span className="text-error" aria-hidden="true">*</span>
                <input required type="number" inputMode="numeric" min="5" step="5" value={newServiceDuration} onChange={e => setNewServiceDuration(e.target.value)} className={CAMPO} placeholder="60" />
              </label>
              <label className={ROTULO}>
                Preparo da sala (min)
                <input type="number" inputMode="numeric" min="0" step="5" value={newServiceTempoHigienizacao} onChange={e => setNewServiceTempoHigienizacao(e.target.value)} className={CAMPO} placeholder="0" />
              </label>
            </div>
            {Number(newServiceDuration) > 0 && (
              <p className="text-xs text-on-surface-variant">
                Ocupa a agenda por <strong className="text-on-surface">{formatDuration(Number(newServiceDuration) + (Number(newServiceTempoHigienizacao) || 0))}</strong>
                {Number(newServiceTempoHigienizacao) > 0 ? ' (atendimento + preparo).' : '.'}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className={LEGENDA}>3. Quem pode atender</legend>
            <label className={ROTULO}>
              Regra
              <select value={serviceEligibilityMode} onChange={(e) => setServiceEligibilityMode(e.target.value as ServiceEligibilityMode)} className={CAMPO}>
                <option value="livre">Qualquer profissional</option>
                <option value="cargo">Só alguns cargos</option>
                <option value="habilidade">Só quem tem certas habilidades</option>
                <option value="profissional">Só profissionais escolhidos</option>
              </select>
            </label>
            {regra && (
              <div>
                <label className={ROTULO}>
                  {regra.rotulo} <span className="font-normal text-on-surface-variant">(separados por vírgula)</span>
                  <input type="text" value={regra.valor} onChange={(e) => regra.alterar(e.target.value)} className={CAMPO} placeholder={regra.exemplo} />
                </label>
                {regra.opcoes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {regra.opcoes.map((opcao) => (
                      <button key={opcao} type="button" onClick={() => regra.alterar((prev) => appendRuleToken(prev, opcao))} className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold hover:bg-primary/20">
                        + {opcao}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </fieldset>

          <div className="flex gap-3">
            {editingServiceId && (
              <button type="button" onClick={cancelServiceEdit} className="flex-1 h-11 rounded-xl border border-outline-variant/30 text-sm font-bold text-on-surface hover:bg-surface-container">
                Cancelar
              </button>
            )}
            <button type="submit" disabled={salvandoServico} className="flex-1 h-11 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary-dim disabled:opacity-60">
              {salvandoServico ? 'Salvando...' : editingServiceId ? 'Salvar alterações' : 'Adicionar serviço'}
            </button>
          </div>
        </form>
      </section>
      <ConfirmDialog
        open={Boolean(servicoParaExcluir)}
        title={`Excluir o serviço ${servicoParaExcluir?.nome ?? ''}?`}
        description={erroExclusao ?? 'O serviço será apagado. Se ele já foi usado em atendimentos, use "Tirar de linha" (ícone de olho) para escondê-lo sem perder o histórico.'}
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
