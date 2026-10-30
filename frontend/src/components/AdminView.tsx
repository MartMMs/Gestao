import React, { useState } from 'react';
import { useToast } from '../hooks/useToast';
import { motion } from 'motion/react';
import { Appointment, Client, Employee, Service, ServiceEligibilityMode, EmployeeUpdate } from '../types';
import { SupervisorDashboardTab } from '../features/dashboard/components';
import { SupervisorClientesTab } from '../features/clients/components';
import { SupervisorEquipeTab } from '../features/team/components';
import { SupervisorServicosTab } from '../features/services/components';
import { gerarSenhaProvisoria } from '../utils/formatters';
import { AutoatendimentoAdminTab } from '../features/autoatendimento/components';
import { CompanySettingsTab } from '../features/company/components/CompanySettingsTab';
import { RelatorioFinanceiroTab } from '../features/reports/components';
import { useCompanyConfig } from '../api';

type ServicePayload = {
  nome: string;
  preco: number | string;
  duracao: number | string;
  icone?: string;
  descricao?: string;
  modoElegibilidade?: ServiceEligibilityMode;
  cargosPermitidos?: string[];
  habilidadesPermitidas?: string[];
  profissionaisPermitidos?: string[];
  categoria?: string;
  tempoHigienizacaoMin?: number | string;
  comissaoPercentual?: number | string;
};

const normalizeRuleList = (value: string): string[] => Array.from(new Set(value
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)));

const appendRuleToken = (currentValue: string, nextToken: string): string => {
  const merged = Array.from(new Set([...normalizeRuleList(currentValue), nextToken.trim()].filter(Boolean)));
  return merged.join(', ');
};

const getEligibilitySummary = (service: Service): string => {
  const mode = service.modoElegibilidade || 'livre';

  if (mode === 'cargo') {
    const cargos = Array.isArray(service.cargosPermitidos) ? service.cargosPermitidos.filter(Boolean) : [];
    return cargos.length > 0 ? `Somente cargos: ${cargos.join(', ')}` : 'Restrito por cargo';
  }

  if (mode === 'habilidade') {
    const habilidades = Array.isArray(service.habilidadesPermitidas) ? service.habilidadesPermitidas.filter(Boolean) : [];
    return habilidades.length > 0 ? `Somente habilidades: ${habilidades.join(', ')}` : 'Restrito por habilidade';
  }

  if (mode === 'profissional') {
    const profissionais = Array.isArray(service.profissionaisPermitidos) ? service.profissionaisPermitidos.filter(Boolean) : [];
    return profissionais.length > 0 ? `Somente profissionais: ${profissionais.join(', ')}` : 'Restrito por profissional';
  }

  return 'Disponível para qualquer profissional';
};

interface AdminViewProps {
  employees: Employee[];
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  onAddEmployee: (employee: Omit<Employee, 'id' | 'rating' | 'completedServices'> & { password: string }) => Promise<boolean | string | void> | void;
  onDeleteEmployee: (id: string, reallocateToId?: string) => Promise<unknown> | void;
  onEditEmployee: (id: string, employee: EmployeeUpdate) => Promise<boolean | string | void> | void;
  onAddService: (service: ServicePayload) => Promise<boolean | string | void>;
  onEditService: (id: string, service: ServicePayload) => Promise<boolean | string | void>;
  onDeleteService: (id: string) => Promise<unknown> | void;
  onAddClient?: (client: Omit<Client, 'id'>) => void;
  onEditClient?: (id: string, client: Partial<Client>) => void;
  onDeleteClient?: (id: string) => void;
  token?: string | null;
}

export function AdminView({
  employees,
  appointments,
  services,
  clients,
  onAddEmployee,
  onDeleteEmployee,
  onEditEmployee,
  onAddService,
  onEditService,
  onDeleteService,
  onAddClient,
  onEditClient,
  onDeleteClient,
  token,
}: AdminViewProps) {
  const { data: companyConfig } = useCompanyConfig(token);
  const [activeTab, setActiveTab] = useState<'empresa' | 'servicos' | 'totem' | 'equipe' | 'dashboard' | 'clientes' | 'relatorios'>('empresa');

  // Gestão de Serviços
  const [serviceSearchTerm, setServiceSearchTerm] = useState('');
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [newServiceName, setNewServiceName] = useState('');
  const [newServicePrice, setNewServicePrice] = useState('');
  const [newServiceDuration, setNewServiceDuration] = useState('60');
  const [newServiceIcon, setNewServiceIcon] = useState('storefront');
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [serviceEligibilityMode, setServiceEligibilityMode] = useState<ServiceEligibilityMode>('livre');
  const [newServiceCategoria, setNewServiceCategoria] = useState('');
  const [newServiceTempoHigienizacao, setNewServiceTempoHigienizacao] = useState('0');
  const [newServiceComissao, setNewServiceComissao] = useState('');
  const [serviceAllowedCargosInput, setServiceAllowedCargosInput] = useState('');
  const [serviceAllowedSkillsInput, setServiceAllowedSkillsInput] = useState('');
  const [serviceAllowedProfessionalsInput, setServiceAllowedProfessionalsInput] = useState('');

  // Gestão de Equipe
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpSpecialty, setNewEmpSpecialty] = useState('');
  const [newEmpRole, setNewEmpRole] = useState<'collaborator' | 'supervisor' | 'admin'>('collaborator');
  const [newEmpCargo, setNewEmpCargo] = useState('');
  const [newEmpDiasTrabalho, setNewEmpDiasTrabalho] = useState<string[]>(['1', '2', '3', '4', '5', '6']);
  const [newEmpSkillsInput, setNewEmpSkillsInput] = useState('');

  // Clientes
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientCpf, setNewClientCpf] = useState('');
  const [newClientObservation, setNewClientObservation] = useState('');

  // Toast
  const { toastMessage, setToastMessage } = useToast();

  const [erroPainel, setErroPainel] = useState<string | null>(null);
  const [senhaCriada, setSenhaCriada] = useState<{ email: string; senha: string } | null>(null);

  const showToast = (msg: string | null) => {
    setToastMessage(msg);
  };

  const filteredServices = services.filter((s) => {
    const q = serviceSearchTerm.toLowerCase();
    return s.nome.toLowerCase().includes(q) || (s.categoria && s.categoria.toLowerCase().includes(q));
  });

  const availableCargos = Array.from(new Set(employees.map((e) => e.cargo || e.specialty).filter(Boolean)));
  const availableSkills = Array.from(new Set(employees.flatMap((e) => e.habilidades || []).filter(Boolean)));
  const availableProfessionals = employees.map((e) => e.name);

  const handleServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: ServicePayload = {
      nome: newServiceName,
      preco: newServicePrice,
      duracao: newServiceDuration,
      icone: newServiceIcon,
      descricao: newServiceDescription,
      modoElegibilidade: serviceEligibilityMode,
      categoria: newServiceCategoria,
      tempoHigienizacaoMin: newServiceTempoHigienizacao,
      comissaoPercentual: newServiceComissao,
      cargosPermitidos: serviceEligibilityMode === 'cargo' ? normalizeRuleList(serviceAllowedCargosInput) : [],
      habilidadesPermitidas: serviceEligibilityMode === 'habilidade' ? normalizeRuleList(serviceAllowedSkillsInput) : [],
      profissionaisPermitidos: serviceEligibilityMode === 'profissional' ? normalizeRuleList(serviceAllowedProfessionalsInput) : [],
    };

    // Os handlers devolvem true ou a mensagem de erro; em erro, mantém o formulário preenchido
    const resultado = editingServiceId
      ? await onEditService(editingServiceId, payload)
      : await onAddService(payload);
    if (typeof resultado === 'string' || resultado === false) {
      setErroPainel(typeof resultado === 'string' ? resultado : 'Não foi possível salvar o serviço.');
      return;
    }
    setErroPainel(null);
    showToast(editingServiceId ? 'Serviço atualizado com sucesso!' : 'Novo serviço adicionado ao cardápio com sucesso!');
    cancelServiceEdit();
  };

  const cancelServiceEdit = () => {
    setEditingServiceId(null);
    setNewServiceName('');
    setNewServicePrice('');
    setNewServiceDuration('60');
    setNewServiceIcon('storefront');
    setNewServiceDescription('');
    setServiceEligibilityMode('livre');
    setNewServiceCategoria('');
    setNewServiceTempoHigienizacao('0');
    setNewServiceComissao('');
    setServiceAllowedCargosInput('');
    setServiceAllowedSkillsInput('');
    setServiceAllowedProfessionalsInput('');
  };

  const onEditServiceCard = (service: Service) => {
    setEditingServiceId(service.id);
    setNewServiceName(service.nome);
    setNewServicePrice(String(service.preco));
    setNewServiceDuration(String(service.duracao));
    setNewServiceIcon(service.icone || 'storefront');
    setNewServiceDescription(service.descricao || '');
    setServiceEligibilityMode(service.modoElegibilidade || 'livre');
    setNewServiceCategoria(service.categoria || '');
    setNewServiceTempoHigienizacao(String(service.tempoHigienizacaoMin || 0));
    setNewServiceComissao(service.comissaoPercentual !== undefined ? String(service.comissaoPercentual) : '');
    setServiceAllowedCargosInput((service.cargosPermitidos || []).join(', '));
    setServiceAllowedSkillsInput((service.habilidadesPermitidas || []).join(', '));
    setServiceAllowedProfessionalsInput((service.profissionaisPermitidos || []).join(', '));
  };

  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const skills = newEmpSkillsInput.split(',').map((s) => s.trim()).filter(Boolean);
    try {

    if (editingEmployeeId) {
      const resultado = await onEditEmployee(editingEmployeeId, {
        name: newEmpName,
        email: newEmpEmail,
        specialty: newEmpSpecialty,
        role: newEmpRole,
        cargo: newEmpCargo,
        diasTrabalho: newEmpDiasTrabalho.join(','),
        habilidades: skills,
      });
      if (typeof resultado === 'string' || resultado === false) {
        setErroPainel(typeof resultado === 'string' ? resultado : 'Não foi possível atualizar o colaborador.');
        return;
      }
      showToast('Colaborador atualizado com sucesso!');
    } else {
      const senhaProvisoria = gerarSenhaProvisoria();
      const resultado = await onAddEmployee({
        name: newEmpName,
        email: newEmpEmail,
        password: senhaProvisoria,
        specialty: newEmpSpecialty,
        role: newEmpRole,
        cargo: newEmpCargo,
        avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${newEmpName}`,
        diasTrabalho: newEmpDiasTrabalho.join(','),
        habilidades: skills,
      });
      if (typeof resultado === 'string' || resultado === false) {
        setErroPainel(typeof resultado === 'string' ? resultado : 'Não foi possível adicionar o colaborador.');
        return;
      }
      setSenhaCriada({ email: newEmpEmail, senha: senhaProvisoria });
    }
    setErroPainel(null);
    cancelEmpEdit();
    } catch (error) {
      setErroPainel(error instanceof Error ? error.message : 'Não foi possível salvar o colaborador.');
    }
  };

  const cancelEmpEdit = () => {
    setEditingEmployeeId(null);
    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpSpecialty('');
    setNewEmpRole('collaborator');
    setNewEmpCargo('');
    setNewEmpDiasTrabalho(['1', '2', '3', '4', '5', '6']);
    setNewEmpSkillsInput('');
  };

  const formatDuration = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    return `${m}min`;
  };

  return (
    <div className="space-y-6">
      {/* Barra de Notificação Toast */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 right-8 z-50 bg-primary text-on-primary px-5 py-3 rounded-2xl shadow-xl font-bold text-xs flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">check_circle</span>
          {toastMessage}
        </motion.div>
      )}

      {(erroPainel || senhaCriada) && (
        <div role="alert" className={`fixed top-20 right-8 z-50 max-w-sm px-5 py-4 rounded-2xl shadow-xl text-xs font-bold ${erroPainel ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`}>
          {erroPainel ? erroPainel : (
            <>
              <p>Membro adicionado. Repasse o acesso:</p>
              <p className="mt-1 select-all">{senhaCriada!.email}</p>
              <p className="mt-1 select-all">Senha provisória: {senhaCriada!.senha}</p>
              <p className="mt-1 font-normal">Anote agora: a senha não será exibida de novo.</p>
            </>
          )}
          <button type="button" className="mt-3 underline" onClick={() => { setErroPainel(null); setSenhaCriada(null); }}>Fechar</button>
        </div>
      )}

      {/* Top Banner do Painel Administrador */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/25 p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm shrink-0">
            <span className="material-symbols-outlined text-3xl">{companyConfig?.icone || 'admin_panel_settings'}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                Modo Administrador Geral
              </span>
              <span className="text-xs text-on-surface-variant font-medium">
                {companyConfig?.segmento ? `Segmento: ${companyConfig.segmento.replace('_', ' ').toUpperCase()}` : 'Geral'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-headline font-bold text-on-surface mt-1">
              {companyConfig?.nomeEmpresa || 'Painel Administrativo'}
            </h1>
            <p className="text-xs sm:text-sm text-on-surface-variant font-body">
              {companyConfig?.slogan || 'Gerencie configurações da empresa, serviços, totem de autoatendimento e equipe.'}
            </p>
          </div>
        </div>

        {/* Abas Administrativas */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full custom-scrollbar">
          <button
            type="button"
            onClick={() => setActiveTab('empresa')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'empresa'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">domain</span>
            Empresa & Segmento
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('servicos')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'servicos'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">menu_book</span>
            Cardápio de Serviços
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('totem')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'totem'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">touch_app</span>
            Totem & Autoatendimento
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('equipe')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'equipe'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">group</span>
            Equipe & Papéis
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'dashboard'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">analytics</span>
            Métricas
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('clientes')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'clientes'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">person_search</span>
            Clientes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('relatorios')}
            className={`px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'relatorios'
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container text-on-surface-variant hover:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">monitoring</span>
            Relatórios
          </button>
        </div>
      </div>

      {/* Conteúdo da Aba Ativa */}
      {activeTab === 'empresa' && <CompanySettingsTab token={token || null} />}
      {activeTab === 'relatorios' && <RelatorioFinanceiroTab />}

      {activeTab === 'servicos' && (
        <SupervisorServicosTab
          services={services}
          filteredServices={filteredServices}
          serviceSearchTerm={serviceSearchTerm}
          setServiceSearchTerm={setServiceSearchTerm}
          editingServiceId={editingServiceId}
          cancelServiceEdit={cancelServiceEdit}
          handleServiceSubmit={handleServiceSubmit}
          formatDuration={formatDuration}
          getEligibilitySummary={getEligibilitySummary}
          onEditServiceCard={onEditServiceCard}
          onDeleteServiceCard={onDeleteService}
          confirmarExclusao
          serviceIcons={['storefront', 'content_cut', 'medical_services', 'spa', 'fitness_center', 'brush', 'dry_cleaning']}
          newServiceIcon={newServiceIcon}
          setNewServiceIcon={setNewServiceIcon}
          newServiceName={newServiceName}
          setNewServiceName={setNewServiceName}
          newServicePrice={newServicePrice}
          setNewServicePrice={setNewServicePrice}
          newServiceDuration={newServiceDuration}
          setNewServiceDuration={setNewServiceDuration}
          serviceEligibilityMode={serviceEligibilityMode}
          setServiceEligibilityMode={setServiceEligibilityMode}
          newServiceCategoria={newServiceCategoria}
          setNewServiceCategoria={setNewServiceCategoria}
          newServiceTempoHigienizacao={newServiceTempoHigienizacao}
          setNewServiceTempoHigienizacao={setNewServiceTempoHigienizacao}
          newServiceComissao={newServiceComissao}
          setNewServiceComissao={setNewServiceComissao}
          serviceAllowedCargosInput={serviceAllowedCargosInput}
          setServiceAllowedCargosInput={setServiceAllowedCargosInput}
          serviceAllowedSkillsInput={serviceAllowedSkillsInput}
          setServiceAllowedSkillsInput={setServiceAllowedSkillsInput}
          serviceAllowedProfessionalsInput={serviceAllowedProfessionalsInput}
          setServiceAllowedProfessionalsInput={setServiceAllowedProfessionalsInput}
          availableCargos={availableCargos}
          availableSkills={availableSkills}
          availableProfessionals={availableProfessionals}
          appendRuleToken={appendRuleToken}
          newServiceDescription={newServiceDescription}
          setNewServiceDescription={setNewServiceDescription}
        />
      )}

      {activeTab === 'totem' && <AutoatendimentoAdminTab />}

      {activeTab === 'equipe' && (
        <SupervisorEquipeTab
          employees={employees}
          onAddEmployee={onAddEmployee}
          onDeleteEmployee={onDeleteEmployee}
          onEditEmployee={onEditEmployee}
          onSaveScaleOverride={() => {}}
          setToastMessage={showToast}
          setErrorMessage={(msg) => { if (msg) showToast(msg); }}
          onViewEmployee={() => {}}
        />
      )}

      {activeTab === 'dashboard' && (
        <SupervisorDashboardTab
          employees={employees}
          appointments={appointments}
          services={services}
        />
      )}

      {activeTab === 'clientes' && (
        <SupervisorClientesTab
          clients={clients}
          appointments={appointments}
          services={services}
          onEditClient={onEditClient}
          onDeleteClient={onDeleteClient}
          setToastMessage={showToast}
        />
      )}
    </div>
  );
}
