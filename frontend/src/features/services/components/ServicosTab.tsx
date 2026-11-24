import React, { useDeferredValue, useMemo, useState } from 'react';
import { Employee, Service, ServiceEligibilityMode } from '../../../types';
import { useHabilidades } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { normalizarTexto } from '@shared/validadores';
import { atendeNaAgenda } from '../../../utils/formatters';
import { SupervisorServicosTab } from './SupervisorServicosTab';

export type ServicePayload = {
  nome: string;
  preco: number | string;
  duracao: number | string;
  icone?: string;
  descricao?: string;
  modoElegibilidade?: ServiceEligibilityMode;
  cargosPermitidos?: string[];
  habilidadeIds?: string[];
  profissionaisPermitidos?: string[];
  categoria?: string;
  tempoHigienizacaoMin?: number | string;
  comissaoPercentual?: number | string;
};

export const SERVICE_ICONS = ['design_services', 'event_available', 'content_cut', 'medical_services', 'fitness_center', 'spa', 'storefront', 'brush', 'dry_cleaning'];

const listaDaRegra = (valor: string): string[] => Array.from(new Set(valor.split(',').map((v) => v.trim()).filter(Boolean)));
const appendRuleToken = (atual: string, token: string) => Array.from(new Set([...listaDaRegra(atual), token.trim()].filter(Boolean))).join(', ');

export const formatDuration = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
};

export const getEligibilitySummary = (service: Service): string => {
  const lista = (v?: string[]) => (Array.isArray(v) ? v.filter(Boolean) : []);
  if (service.modoElegibilidade === 'cargo') {
    const cargos = lista(service.cargosPermitidos);
    return cargos.length > 0 ? `Somente cargos: ${cargos.join(', ')}` : 'Restrito por cargo';
  }
  if (service.modoElegibilidade === 'habilidade') {
    return lista(service.habilidadesPermitidas).length > 0 ? 'Só quem tem uma das habilidades acima' : 'Habilidades exigidas arquivadas: qualquer profissional atende';
  }
  if (service.modoElegibilidade === 'profissional') {
    const profissionais = lista(service.profissionaisPermitidos);
    return profissionais.length > 0 ? `Somente profissionais: ${profissionais.join(', ')}` : 'Restrito por profissional';
  }
  return 'Disponível para qualquer profissional';
};

type Resultado = Promise<boolean | string | void>;

interface ServicosTabProps {
  services: Service[];
  employees: Employee[];
  onAddService: (service: ServicePayload) => Resultado;
  onEditService: (id: string, service: ServicePayload) => Resultado;
  onDeleteService: (id: string) => Promise<unknown> | void;
  // Aviso da tela que hospeda a aba (cada painel tem o seu toast)
  avisar: (mensagem: string, tipo: 'sucesso' | 'erro') => void;
}

const VAZIO = {
  nome: '', preco: '', duracao: '60', icone: SERVICE_ICONS[0], descricao: '', modo: 'livre' as ServiceEligibilityMode, categoria: '',
  higiene: '0', comissao: '', cargos: '', profissionais: '',
};

// Aba Serviços: a mesma para Admin e Supervisor (antes cada painel tinha sua cópia, com ícones e durações diferentes)
export function ServicosTab({ services, employees, onAddService, onEditService, onDeleteService, avisar }: ServicosTabProps) {
  const { token } = useAuth();
  const { data: habilidadesAtivas = [] } = useHabilidades(token);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const buscaAdiada = useDeferredValue(busca);
  const [f, setF] = useState(VAZIO);
  const [habilidadeIds, setHabilidadeIds] = useState<string[]>([]);
  const campo = <K extends keyof typeof VAZIO>(k: K) => (v: (typeof VAZIO)[K]) => setF((atual) => ({ ...atual, [k]: v }));
  const campoComFuncao = (k: 'cargos' | 'profissionais'): React.Dispatch<React.SetStateAction<string>> =>
    (v) => setF((atual) => ({ ...atual, [k]: typeof v === 'function' ? v(atual[k]) : v }));

  const filteredServices = useMemo(() => {
    const q = normalizarTexto(buscaAdiada);
    if (!q) return services;
    return services.filter((s) => [s.nome, s.categoria, s.descricao, s.icone].filter(Boolean).some((v) => normalizarTexto(String(v)).includes(q)));
  }, [services, buscaAdiada]);

  const ordenados = (lista: string[]) => Array.from(new Set(lista.map((v) => v.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const availableCargos = useMemo(() => ordenados(employees.map((e) => e.cargo || e.specialty || '')), [employees]);
  const availableProfessionals = useMemo(() => ordenados(employees.filter(atendeNaAgenda).map((e) => e.name || '')), [employees]);

  const cancelServiceEdit = () => { setEditingServiceId(null); setF(VAZIO); setHabilidadeIds([]); };

  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: ServicePayload = {
      nome: f.nome, preco: f.preco, duracao: f.duracao, icone: f.icone, descricao: f.descricao, modoElegibilidade: f.modo,
      categoria: f.categoria, tempoHigienizacaoMin: f.higiene, comissaoPercentual: f.comissao,
      cargosPermitidos: f.modo === 'cargo' ? listaDaRegra(f.cargos) : [],
      habilidadeIds: f.modo === 'habilidade' ? habilidadeIds : [],
      profissionaisPermitidos: f.modo === 'profissional' ? listaDaRegra(f.profissionais) : [],
    };
    try {
      // Os handlers devolvem true ou a mensagem de erro; em erro, o formulário continua preenchido
      const resultado = editingServiceId ? await onEditService(editingServiceId, payload) : await onAddService(payload);
      if (typeof resultado === 'string' || resultado === false) {
        avisar(typeof resultado === 'string' ? resultado : 'Não foi possível salvar o serviço. Tente novamente.', 'erro');
        return;
      }
      avisar(editingServiceId ? 'Serviço atualizado com sucesso!' : 'Serviço adicionado ao menu!', 'sucesso');
      cancelServiceEdit();
    } catch (error) {
      avisar(error instanceof Error ? error.message : 'Erro ao salvar serviço.', 'erro');
    }
  };

  const onEditServiceCard = (srv: Service) => {
    setEditingServiceId(srv.id);
    setF({
      nome: srv.nome, preco: String(srv.preco), duracao: String(srv.duracao || 60), icone: srv.icone || SERVICE_ICONS[0], descricao: srv.descricao || '',
      modo: srv.modoElegibilidade || 'livre', categoria: srv.categoria || '', higiene: String(srv.tempoHigienizacaoMin || 0),
      comissao: srv.comissaoPercentual !== undefined && srv.comissaoPercentual !== null ? String(srv.comissaoPercentual) : '',
      cargos: (srv.cargosPermitidos || []).join(', '), profissionais: (srv.profissionaisPermitidos || []).join(', '),
    });
    setHabilidadeIds(srv.habilidadeIds || []);
  };

  const excluir = async (id: string) => {
    await onDeleteService(id);
    avisar('Serviço excluído com sucesso!', 'sucesso');
  };

  return (
    <SupervisorServicosTab
      services={services}
      filteredServices={filteredServices}
      serviceSearchTerm={busca}
      setServiceSearchTerm={setBusca}
      editingServiceId={editingServiceId}
      cancelServiceEdit={cancelServiceEdit}
      handleServiceSubmit={handleServiceSubmit}
      formatDuration={formatDuration}
      getEligibilitySummary={getEligibilitySummary}
      onEditServiceCard={onEditServiceCard}
      onDeleteServiceCard={excluir}
      confirmarExclusao
      serviceIcons={SERVICE_ICONS}
      newServiceIcon={f.icone}
      setNewServiceIcon={campo('icone')}
      newServiceName={f.nome}
      setNewServiceName={campo('nome')}
      newServicePrice={f.preco}
      setNewServicePrice={campo('preco')}
      newServiceDuration={f.duracao}
      setNewServiceDuration={campo('duracao')}
      serviceEligibilityMode={f.modo}
      setServiceEligibilityMode={campo('modo')}
      newServiceCategoria={f.categoria}
      setNewServiceCategoria={campo('categoria')}
      newServiceTempoHigienizacao={f.higiene}
      setNewServiceTempoHigienizacao={campo('higiene')}
      newServiceComissao={f.comissao}
      setNewServiceComissao={campo('comissao')}
      serviceAllowedCargosInput={f.cargos}
      setServiceAllowedCargosInput={campoComFuncao('cargos')}
      habilidadeIds={habilidadeIds}
      setHabilidadeIds={setHabilidadeIds}
      habilidadesAtivas={habilidadesAtivas}
      serviceAllowedProfessionalsInput={f.profissionais}
      setServiceAllowedProfessionalsInput={campoComFuncao('profissionais')}
      availableCargos={availableCargos}
      availableProfessionals={availableProfessionals}
      appendRuleToken={appendRuleToken}
      newServiceDescription={f.descricao}
      setNewServiceDescription={campo('descricao')}
    />
  );
}
