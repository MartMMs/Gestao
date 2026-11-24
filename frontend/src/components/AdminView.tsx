import { HorarioFuncionamentoCard } from '../features/company/components/HorarioFuncionamentoCard';
import React, { useState } from 'react';
import { useToast } from '../hooks/useToast';
import { motion } from 'motion/react';
import { Appointment, Client, Employee, Service, EmployeeUpdate } from '../types';
import { SupervisorDashboardTab } from '../features/dashboard/components';
import { SupervisorClientesTab } from '../features/clients/components';
import { SupervisorEquipeTab } from '../features/team/components';
import { ServicosTab, type ServicePayload } from '../features/services/components';
import { AutoatendimentoAdminTab } from '../features/autoatendimento/components';
import { WhatsappLembretesTab } from '../features/appointments/components';
import { CompanySettingsTab } from '../features/company/components/CompanySettingsTab';
import { RelatorioFinanceiroTab } from '../features/reports/components';
import { useCompanyConfig } from '../api';

interface AdminViewProps {
  employees: Employee[];
  // Todas as contas ativas (supervisão e recepção inclusas): só a aba Equipe usa; "employees" é quem atende
  todasAsContas: Employee[];
  appointments: Appointment[];
  services: Service[];
  clients: Client[];
  onAddEmployee: (employee: Omit<Employee, 'id' | 'rating' | 'completedServices'> & { password: string }) => Promise<boolean | string | void> | void;
  onDeleteEmployee: (id: string, reallocateToId?: string) => Promise<unknown> | void;
  onEditEmployee: (id: string, employee: EmployeeUpdate) => Promise<boolean | string | void> | void;
  onSaveScaleOverride?: (payload: { colaboradorId: string; data: string; tipo: 'trabalho' | 'folga' | 'fds'; turno?: string; descricao?: string }) => Promise<boolean | string | void> | void;
  onAddService: (service: ServicePayload) => Promise<boolean | string | void>;
  onEditService: (id: string, service: ServicePayload) => Promise<boolean | string | void>;
  onDeleteService: (id: string) => Promise<unknown> | void;
  onEditClient?: (id: string, client: Partial<Client>) => void;
  onDeleteClient?: (id: string) => void;
  token?: string | null;
}

export function AdminView({
  employees,
  todasAsContas,
  appointments,
  services,
  clients,
  onAddEmployee,
  onDeleteEmployee,
  onEditEmployee,
  onSaveScaleOverride,
  onAddService,
  onEditService,
  onDeleteService,
  onEditClient,
  onDeleteClient,
  token,
}: AdminViewProps) {
  const { data: companyConfig } = useCompanyConfig(token);
  const [activeTab, setActiveTab] = useState<'empresa' | 'servicos' | 'totem' | 'equipe' | 'dashboard' | 'clientes' | 'relatorios'>('empresa');

  // Toast
  const { toastMessage, setToastMessage } = useToast();

  const [erroPainel, setErroPainel] = useState<string | null>(null);

  const showToast = (msg: string | null) => {
    // Sucesso e erro ocupam o mesmo canto da tela: um tira o outro
    if (msg) setErroPainel(null);
    setToastMessage(msg);
  };
  const mostrarErro = (msg: string | null) => {
    if (msg) setToastMessage(null);
    setErroPainel(msg);
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* Barra de Notificação Toast */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed top-20 right-8 z-100 bg-primary text-on-primary px-5 py-3 rounded-2xl shadow-xl font-bold text-xs flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">check_circle</span>
          {toastMessage}
        </motion.div>
      )}

      {/* No celular embaixo: em cima cobria o X e os primeiros campos do formulário aberto */}
      {erroPainel && (
        <div role="alert" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-auto sm:top-20 sm:right-8 z-100 sm:max-w-sm px-5 py-4 rounded-2xl shadow-xl text-xs font-bold bg-error text-on-error">
          {erroPainel}
          <button type="button" className="mt-3 block underline" onClick={() => setErroPainel(null)}>Fechar</button>
        </div>
      )}

      {/* Top Banner do Painel Administrador */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/25 p-6 rounded-3xl shadow-sm">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-sm shrink-0">
            <span className="material-symbols-outlined text-3xl">{companyConfig?.icone || 'admin_panel_settings'}</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
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
        <div className="flex flex-wrap items-center gap-2 min-w-0">
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
            Serviços
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
            Totem, Autoatendimento & WhatsApp
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
      {activeTab === 'empresa' && (
        <div className="space-y-8">
          <HorarioFuncionamentoCard />
          <CompanySettingsTab token={token || null} />
        </div>
      )}
      {activeTab === 'relatorios' && <RelatorioFinanceiroTab />}

      {activeTab === 'servicos' && (
        <ServicosTab
          services={services}
          employees={employees}
          onAddService={onAddService}
          onEditService={onEditService}
          onDeleteService={onDeleteService}
          avisar={(msg, tipo) => (tipo === 'erro' ? mostrarErro(msg) : showToast(msg))}
        />
      )}

      {activeTab === 'totem' && (
        <div className="space-y-8">
          <AutoatendimentoAdminTab />
          <WhatsappLembretesTab token={token || null} />
        </div>
      )}

      {activeTab === 'equipe' && (
        <SupervisorEquipeTab
          employees={todasAsContas}
          onAddEmployee={onAddEmployee}
          onDeleteEmployee={onDeleteEmployee}
          onEditEmployee={onEditEmployee}
          onSaveScaleOverride={onSaveScaleOverride}
          setToastMessage={showToast}
          // Erro ia para o toast de sucesso (ícone de ok), escondido atrás do formulário aberto: "Cadastrar" parecia não fazer nada
          setErrorMessage={mostrarErro}
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
