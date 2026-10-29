import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Employee, Role, EmployeeUpdate } from '../../../types';
import { useAuth } from '../../../AuthContext';
import { isApiError } from '../../../api';
import { useSearch } from '../../../hooks/useSearch';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { isTeamMember, gerarSenhaProvisoria, gerarEmailUnico } from '../../../utils/formatters';

interface SupervisorEquipeTabProps {
  employees: Employee[];
  onAddEmployee: (employee: Omit<Employee, 'id' | 'rating' | 'completedServices'> & { password: string }) => Promise<boolean | string | void> | void;
  onDeleteEmployee: (id: string, reallocateToId?: string) => Promise<unknown> | void;
  onEditEmployee: (id: string, employee: EmployeeUpdate) => Promise<boolean | string | void> | void;
  onSaveScaleOverride?: (payload: { colaboradorId: string; data: string; tipo: 'trabalho' | 'folga' | 'fds'; turno?: string; descricao?: string }) => Promise<boolean | string | void> | void;
  setToastMessage: (msg: string | null) => void;
  setErrorMessage: (msg: string | null) => void;
  onViewEmployee?: (emp: Employee) => void;
}

const getTodayLocalDate = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export function SupervisorEquipeTab({ employees, onAddEmployee, onDeleteEmployee, onEditEmployee, onSaveScaleOverride, setToastMessage, setErrorMessage, onViewEmployee }: SupervisorEquipeTabProps) {
  const WEEK_DAYS = [
    { value: '0', label: 'DOM' },
    { value: '1', label: 'SEG' },
    { value: '2', label: 'TER' },
    { value: '3', label: 'QUA' },
    { value: '4', label: 'QUI' },
    { value: '5', label: 'SEX' },
    { value: '6', label: 'SÁB' },
  ];
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpSpecialty, setNewEmpSpecialty] = useState('');
  const [newEmpCargo, setNewEmpCargo] = useState('');
  const [newEmpTipoEscala, setNewEmpTipoEscala] = useState<Employee['tipoEscala']>('6x1');
  const [newEmpFolgasDomingoNoMes, setNewEmpFolgasDomingoNoMes] = useState(2);
  const [newEmpCargaHoraria, setNewEmpCargaHoraria] = useState(40);
  const [newEmpHabilidades, setNewEmpHabilidades] = useState<string[]>([]);
  const [newEmpRole, setNewEmpRole] = useState<Role>('collaborator');
  const { currentUser } = useAuth();
  const podeGerenciarSupervisores = currentUser?.role === 'admin';
  const [newEmpDiasTrabalho, setNewEmpDiasTrabalho] = useState<string[]>(['1','2','3','4','5','6']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [employeeCurrentPage, setEmployeeCurrentPage] = useState(1);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedEmpForSchedule, setSelectedEmpForSchedule] = useState<Employee | null>(null);
  const [scheduleHourStart, setScheduleHourStart] = useState('09:00');
  const [scheduleHourEnd, setScheduleHourEnd] = useState('18:00');
  const [scheduleDays, setScheduleDays] = useState<string[]>(['1','2','3','4','5','6']);
  const [bulkSelectedEmployeeIds, setBulkSelectedEmployeeIds] = useState<string[]>([]);
  const [bulkShiftSelection, setBulkShiftSelection] = useState<'' | 'manha' | 'tarde' | 'folga'>('');
  const [bulkTargetDate, setBulkTargetDate] = useState(getTodayLocalDate());
  const [isApplyingBulkShift, setIsApplyingBulkShift] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; email: string; password: string; redefinida?: boolean } | null>(null);
  const [employeeToResetPassword, setEmployeeToResetPassword] = useState<Employee | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  // Própria senha não se redefine aqui (derrubaria a sessão antes de mostrar a nova); supervisor só redefine quem não é supervisor/admin
  const podeRedefinirSenha = (emp: Employee) => emp.id !== currentUser?.id
    && (podeGerenciarSupervisores || (emp.role !== 'supervisor' && emp.role !== 'admin'));
  const EMPLOYEES_PER_PAGE = 6;
  const SKILL_OPTIONS = ['Massagem', 'Acupuntura', 'Fisioterapia', 'Aromaterapia', 'Drenagem Linfática'];
  const selectableEmployees = useMemo(() => employees.filter(isTeamMember), [employees]);

  // --- ESTADOS DA GESTÃO DE TURNOS ---
  const [activeSubTab, setActiveSubTab] = useState<'profissionais' | 'gestao'>('profissionais');
  const [turnos, setTurnos] = useState<{id: string, nome: string, inicio: string, fim: string}[]>([
    { id: '1', nome: 'Turno Manhã', inicio: '06:00', fim: '14:00' },
    { id: '2', nome: 'Turno Tarde', inicio: '14:00', fim: '22:00' },
    { id: '3', nome: 'Turno Noite', inicio: '22:00', fim: '06:00' },
    { id: '4', nome: 'Comercial', inicio: '08:00', fim: '18:00' },
  ]);
  const [novoTurnoNome, setNovoTurnoNome] = useState('');
  const [novoTurnoInicio, setNovoTurnoInicio] = useState('08:00');
  const [novoTurnoFim, setNovoTurnoFim] = useState('18:00');

  const handleAddTurno = (e: React.FormEvent) => {
    e.preventDefault();
    if(!novoTurnoNome.trim() || !novoTurnoInicio || !novoTurnoFim) return;
    setTurnos([...turnos, { id: Date.now().toString(), nome: novoTurnoNome.trim(), inicio: novoTurnoInicio, fim: novoTurnoFim }]);
    setNovoTurnoNome('');
    setToastMessage('Turno adicionado.');
  };

  const generateEmployeeEmail = (fullName: string) => gerarEmailUnico(fullName, employees.map((emp) => emp.email));

  const liveGeneratedEmail = generateEmployeeEmail(newEmpName);

  const filteredEmployees = useSearch(
    employees,
    searchTerm,
    emp => [emp.name, emp.email, emp.specialty, emp.role]
  );

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpSpecialty.trim()) {
      setErrorMessage('Preencha o nome e a especialidade do profissional.');
      return;
    }
    
    setIsSubmitting(true);
    let success: boolean | string | void = false;

    try {
      if (editingEmployeeId) {
        success = await onEditEmployee(editingEmployeeId, {
          name: newEmpName,
          email: newEmpEmail,
          specialty: newEmpSpecialty,
          cargo: newEmpCargo.trim() || newEmpSpecialty.trim(),
          tipoEscala: newEmpTipoEscala,
          folgasDomingoNoMes: newEmpFolgasDomingoNoMes,
          cargaHorariaSemanal: newEmpCargaHoraria,
          habilidades: newEmpHabilidades,
          role: newEmpRole,
          diasTrabalho: newEmpDiasTrabalho.join(','),
        });
        if (typeof success === 'string') { setErrorMessage(success); success = false; }
        else if (success !== false) { setToastMessage('Colaborador atualizado com sucesso!'); }
      } else {
        const generatedEmail = generateEmployeeEmail(newEmpName);
        const senhaProvisoria = gerarSenhaProvisoria();
        success = await onAddEmployee({
          name: newEmpName,
          email: generatedEmail,
          password: senhaProvisoria,
          role: newEmpRole,
          specialty: newEmpSpecialty,
          cargo: newEmpCargo.trim() || newEmpSpecialty.trim(),
          tipoEscala: newEmpTipoEscala,
          folgasDomingoNoMes: newEmpFolgasDomingoNoMes,
          cargaHorariaSemanal: newEmpCargaHoraria,
          habilidades: newEmpHabilidades,
          diasTrabalho: newEmpDiasTrabalho.join(','),
          avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${newEmpName}`,
        });
        if (typeof success === 'string') { setErrorMessage(success); success = false; }
        else if (success !== false) {
          setToastMessage('Colaborador adicionado com sucesso!');
          setCreatedCredentials({ name: newEmpName, email: generatedEmail, password: senhaProvisoria });
        }
      }

      if (success !== false) { cancelEdit(); }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao salvar colaborador.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelEdit = () => {
    setEditingEmployeeId(null);
    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpSpecialty('');
    setNewEmpCargo('');
    setNewEmpTipoEscala('6x1');
    setNewEmpFolgasDomingoNoMes(2);
    setNewEmpCargaHoraria(40);
    setNewEmpHabilidades([]);
    setNewEmpRole('collaborator');
    setNewEmpDiasTrabalho(['1','2','3','4','5','6']);
    setShowEmployeeForm(false);
  };

  const openCreateEmployeeForm = () => {
    setEditingEmployeeId(null);
    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpSpecialty('');
    setNewEmpCargo('');
    setNewEmpTipoEscala('6x1');
    setNewEmpFolgasDomingoNoMes(2);
    setNewEmpCargaHoraria(40);
    setNewEmpHabilidades([]);
    setNewEmpRole('collaborator');
    setNewEmpDiasTrabalho(['1','2','3','4','5','6']);
    setCreatedCredentials(null);
    setShowEmployeeForm(true);
  };

  const toggleWorkDay = (day: string) => {
    setNewEmpDiasTrabalho(prev => prev.includes(day) ? prev.filter(item => item !== day) : [...prev, day].sort());
  };

  const toggleSkill = (skill: string) => {
    setNewEmpHabilidades(prev => prev.includes(skill) ? prev.filter(item => item !== skill) : [...prev, skill]);
  };

  const toggleScheduleDay = (day: string) => {
    setScheduleDays(prev => prev.includes(day) ? prev.filter(item => item !== day) : [...prev, day].sort());
  };

  const openScheduleModal = (emp: Employee) => {
    setSelectedEmpForSchedule(emp);
    setScheduleDays((emp.diasTrabalho || '1,2,3,4,5,6').split(','));
    setScheduleHourStart('09:00');
    setScheduleHourEnd('18:00');
    setBulkSelectedEmployeeIds([emp.id]);
    setBulkShiftSelection('');
    setBulkTargetDate(getTodayLocalDate());
    setShowScheduleModal(true);
  };

  const closeScheduleModal = () => {
    setShowScheduleModal(false);
    setSelectedEmpForSchedule(null);
    setBulkSelectedEmployeeIds([]);
    setBulkShiftSelection('');
    setIsApplyingBulkShift(false);
  };

  const toggleBulkSelection = (employeeId: string) => {
    setBulkSelectedEmployeeIds((prev) => (
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId]
    ));
  };

  const toggleSelectAllBulk = () => {
    setBulkSelectedEmployeeIds((prev) => {
      if (prev.length === selectableEmployees.length) return [];
      return selectableEmployees.map((emp) => emp.id);
    });
  };

  const handleBulkShiftChange = (value: '' | 'manha' | 'tarde' | 'folga') => {
    setBulkShiftSelection(value);
    if (value === 'manha') {
      setScheduleHourStart('06:00');
      setScheduleHourEnd('14:00');
      if (scheduleDays.length === 0) setScheduleDays(['1', '2', '3', '4', '5', '6']);
      return;
    }

    if (value === 'tarde') {
      setScheduleHourStart('14:00');
      setScheduleHourEnd('22:00');
      if (scheduleDays.length === 0) setScheduleDays(['1', '2', '3', '4', '5', '6']);
      return;
    }

    if (value === 'folga') {
      setScheduleDays([]);
    }
  };

  const handleApplyBulkShift = async () => {
    if (!onSaveScaleOverride) {
      setErrorMessage('A API de escala em lote não está disponível neste ambiente.');
      return;
    }

    if (bulkSelectedEmployeeIds.length === 0) {
      setErrorMessage('Selecione ao menos um colaborador para aplicar em lote.');
      return;
    }

    if (!bulkShiftSelection) {
      setErrorMessage('Selecione um turno para aplicar em lote.');
      return;
    }

    if (!bulkTargetDate) {
      setErrorMessage('Informe uma data de aplicação para a escala em lote.');
      return;
    }

    setIsApplyingBulkShift(true);

    const payloadFromShift = (employeeId: string) => {
      if (bulkShiftSelection === 'folga') {
        return {
          colaboradorId: employeeId,
          data: bulkTargetDate,
          tipo: 'folga' as const,
          descricao: 'Aplicação em lote (Folga)',
        };
      }

      const turnoLabel = bulkShiftSelection === 'manha' ? '06:00-14:00' : '14:00-22:00';
      return {
        colaboradorId: employeeId,
        data: bulkTargetDate,
        tipo: 'trabalho' as const,
        turno: turnoLabel,
        descricao: `Aplicação em lote (${bulkShiftSelection === 'manha' ? 'Manhã' : 'Tarde'})`,
      };
    };

    try {
      const settled = await Promise.allSettled(
        bulkSelectedEmployeeIds.map((employeeId) => Promise.resolve(onSaveScaleOverride(payloadFromShift(employeeId))))
      );

      let failedCount = 0;
      let firstFailureMessage: string | null = null;

      settled.forEach((result) => {
        if (result.status === 'rejected') {
          failedCount += 1;
          if (!firstFailureMessage) {
            firstFailureMessage = result.reason instanceof Error ? result.reason.message : 'Falha ao aplicar escala em lote.';
          }
          return;
        }

        if (result.value === false || typeof result.value === 'string') {
          failedCount += 1;
          if (!firstFailureMessage && typeof result.value === 'string') {
            firstFailureMessage = result.value;
          }
        }
      });

      if (failedCount > 0) {
        const successCount = bulkSelectedEmployeeIds.length - failedCount;
        setErrorMessage(firstFailureMessage || 'Parte da aplicação em lote falhou.');
        if (successCount > 0) {
          setToastMessage(`Lote parcial: ${successCount} aplicado(s), ${failedCount} com falha.`);
        }
        return;
      }

      const shiftLabel = bulkShiftSelection === 'folga' ? 'Folga' : bulkShiftSelection === 'manha' ? 'Manhã' : 'Tarde';
      setToastMessage(`Escala em lote aplicada (${shiftLabel}) para ${bulkSelectedEmployeeIds.length} colaborador(es).`);
      closeScheduleModal();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao aplicar turno em lote.');
    } finally {
      setIsApplyingBulkShift(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!selectedEmpForSchedule || !scheduleHourStart || !scheduleHourEnd) {
      setErrorMessage('Preencha todos os campos da escala.');
      return;
    }

    try {
      const success = await onEditEmployee(selectedEmpForSchedule.id, {
        diasTrabalho: scheduleDays.join(','),
      });
      if (typeof success === 'string') {
        setErrorMessage(success);
      } else if (success !== false) {
        setToastMessage('Escala atualizada com sucesso!');
        closeScheduleModal();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao salvar escala.');
    }
  };

  const paginatedEmployees = useMemo(() => {
    const start = (employeeCurrentPage - 1) * EMPLOYEES_PER_PAGE;
    return filteredEmployees.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [filteredEmployees, employeeCurrentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 w-full">
      {/* Controle de Navegação Interna da Aba */}
      <div className="flex bg-surface-container-low p-1 rounded-full border border-outline-variant/20 overflow-x-auto max-w-fit mb-6">
        <button
          onClick={() => setActiveSubTab('profissionais')}
          className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeSubTab === 'profissionais' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
        >
          Profissionais
        </button>
        <button
          onClick={() => setActiveSubTab('gestao')}
          className={`px-6 py-2 rounded-full text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${activeSubTab === 'gestao' ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
        >
          Regras e Turnos
        </button>
      </div>

      {activeSubTab === 'profissionais' ? (
        <>
          <div className="bg-surface-container-lowest p-5 rounded-3xl border border-outline-variant/10 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
              <div className="relative w-full md:w-80">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">search</span>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => { setSearchTerm(e.target.value); setEmployeeCurrentPage(1); }}
                  placeholder="Buscar profissional..."
                  className="w-full pl-10 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface"
                />
              </div>
              <button
                type="button"
                onClick={() => openCreateEmployeeForm()}
                className="bg-primary text-on-primary px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest shadow-sm hover:bg-primary-dim transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                Criar Usuário
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paginatedEmployees.map(emp => (
              <div key={emp.id} className="bg-surface-container-lowest p-5 rounded-3xl border border-outline-variant/10 shadow-sm">
                <div className="flex items-center gap-3">
                  <img src={emp.avatar} alt={emp.name} className="w-12 h-12 rounded-full object-cover border border-outline-variant/30" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-on-surface truncate">{emp.name}</h4>
                    <p className="text-xs text-on-surface-variant truncate">{emp.email}</p>
                    <p className="text-[10px] uppercase tracking-widest text-primary mt-1">{emp.specialty}</p>
                    <p className="text-[10px] text-on-surface-variant mt-1">{emp.tipoEscala || '6x1'} • {emp.cargaHorariaSemanal || 40}h/sem</p>
                    <p className="text-[10px] text-on-surface-variant">Domingos de folga/mês: {emp.folgasDomingoNoMes ?? 2}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2 border-t border-outline-variant/10 pt-3">
                  <button
                    onClick={() => openScheduleModal(emp)}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                    title="Montar escala"
                  >
                    <span className="material-symbols-outlined text-[20px]">schedule</span>
                  </button>
                  {podeRedefinirSenha(emp) && <button
                    onClick={() => setEmployeeToResetPassword(emp)}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                    title="Redefinir senha"
                  >
                    <span className="material-symbols-outlined text-[20px]">lock_reset</span>
                  </button>}
                  <button
                    onClick={() => onViewEmployee?.(emp)}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                    title="Perfil (RH)"
                  >
                    <span className="material-symbols-outlined text-[20px]">badge</span>
                  </button>
                  <button
                    onClick={() => {
                      setEditingEmployeeId(emp.id);
                      setNewEmpName(emp.name);
                      setNewEmpEmail(emp.email);
                      setNewEmpSpecialty(emp.specialty);
                      setNewEmpCargo(emp.cargo || '');
                      setNewEmpTipoEscala(emp.tipoEscala || '6x1');
                      setNewEmpFolgasDomingoNoMes(emp.folgasDomingoNoMes ?? 2);
                      setNewEmpCargaHoraria(emp.cargaHorariaSemanal || 40);
                      setNewEmpHabilidades(emp.habilidades || []);
                      setNewEmpRole(emp.role === 'supervisor' ? 'supervisor' : 'collaborator');
                      setNewEmpDiasTrabalho((emp.diasTrabalho || '1,2,3,4,5,6').split(','));
                      setShowEmployeeForm(true);
                    }}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                  >
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </button>
                  <button
                    onClick={() => setEmployeeToDelete(emp.id)}
                    className="p-2 text-on-surface-variant hover:bg-error-container/20 hover:text-error rounded-full"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-on-surface-variant">Página {employeeCurrentPage} de {totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setEmployeeCurrentPage(p => Math.max(1, p - 1))} disabled={employeeCurrentPage === 1} className="px-3 py-1 rounded-lg border border-outline-variant/30 text-sm disabled:opacity-40">Anterior</button>
                <button onClick={() => setEmployeeCurrentPage(p => Math.min(totalPages, p + 1))} disabled={employeeCurrentPage === totalPages} className="px-3 py-1 rounded-lg border border-outline-variant/30 text-sm disabled:opacity-40">Próxima</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-6 max-w-2xl">
          {/* CARD GESTÃO DE TURNOS */}
          <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm flex flex-col h-100">
            <div className="flex items-center gap-3 mb-6 shrink-0">
              <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                <span className="material-symbols-outlined">schedule</span>
              </div>
              <div>
                <h3 className="text-lg font-headline text-primary">Turnos Padrão</h3>
                <p className="text-xs text-on-surface-variant">Horários pré-definidos de escala</p>
              </div>
            </div>

            <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-2 mb-4">
              {turnos.map(turno => (
                <div key={turno.id} className="flex items-center justify-between p-3 rounded-xl bg-surface-container-low border border-outline-variant/20 group">
                  <div>
                    <p className="text-sm font-bold text-on-surface leading-tight">{turno.nome}</p>
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mt-0.5">{turno.inicio} às {turno.fim}</p>
                  </div>
                  <button onClick={() => setTurnos(turnos.filter(t => t.id !== turno.id))} className="text-on-surface-variant hover:text-error transition-colors p-1 rounded-full opacity-0 group-hover:opacity-100"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddTurno} className="flex flex-col gap-3 pt-4 border-t border-outline-variant/10 shrink-0">
              <input type="text" value={novoTurnoNome} onChange={e => setNovoTurnoNome(e.target.value)} placeholder="Nome do turno (Ex: Madrugada)" className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none" required />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Início</label>
                  <input type="time" value={novoTurnoInicio} onChange={e => setNovoTurnoInicio(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none" required />
                </div>
                <div className="flex-1">
                  <label className="block text-[9px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Fim</label>
                  <input type="time" value={novoTurnoFim} onChange={e => setNovoTurnoFim(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none" required />
                </div>
                <div className="flex items-end">
                  <button type="submit" className="h-9.5 bg-primary text-on-primary px-4 rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-primary-dim transition-all">Criar</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEmployeeForm && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-50 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelEdit(); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">{editingEmployeeId ? 'Editar Colaborador' : 'Criar Usuário'}</h3>
              <button type="button" onClick={cancelEdit} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <form onSubmit={handleAddEmployee} className="space-y-3 max-h-[78vh] overflow-y-auto pr-1 custom-scrollbar">
              <input required type="text" value={newEmpName} onChange={e => setNewEmpName(e.target.value)} placeholder="Nome" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              <div>
                <input
                  type="email"
                  value={editingEmployeeId ? newEmpEmail : liveGeneratedEmail}
                  onChange={e => setNewEmpEmail(e.target.value)}
                  placeholder="E-mail"
                  readOnly={!editingEmployeeId}
                  className={`w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm ${editingEmployeeId ? '' : 'opacity-80 cursor-not-allowed'}`}
                />
                {!editingEmployeeId && (
                  <p className="mt-1 text-[10px] text-on-surface-variant">
                    Gerado automaticamente a partir do nome completo.
                  </p>
                )}
              </div>
              <input required type="text" value={newEmpSpecialty} onChange={e => setNewEmpSpecialty(e.target.value)} placeholder="Especialidade" maxLength={100} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              {/* Cargo é só o rótulo usado nas regras de serviço ("Somente cargos: ..."); vazio = a especialidade */}
              <input type="text" value={newEmpCargo} onChange={e => setNewEmpCargo(e.target.value)} placeholder="Cargo (rótulo; vazio = especialidade)" aria-label="Cargo" maxLength={60} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              {/* A função de acesso define o que a pessoa pode fazer no sistema */}
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant -mb-2">Função de acesso</label>
              <select aria-label="Função de acesso" value={newEmpRole} onChange={e => setNewEmpRole(e.target.value as Role)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm">
                <option value="collaborator">Colaborador</option>
                <option value="receptionist">Recepção</option>
                {/* Só administradores criam ou promovem supervisores (a API recusa os demais) */}
                {(podeGerenciarSupervisores || newEmpRole === 'supervisor') && <option value="supervisor">Supervisor</option>}
              </select>
              <select value={newEmpTipoEscala || '6x1'} onChange={e => setNewEmpTipoEscala(e.target.value as Employee['tipoEscala'])} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm">
                <option value="6x1">6x1 (6 dias trab, 1 folga)</option>
                <option value="5x1">5x1 (5 dias trab, 1 folga)</option>
                <option value="5x2">5x2 (5 dias trab, 2 folgas)</option>
                <option value="12x36">12x36 (12h trab, 36h folga)</option>
                <option value="rotativo">Rotativo (3 turnos)</option>
                <option value="personalizado">Personalizado</option>
              </select>
              <input type="number" min={0} max={5} value={newEmpFolgasDomingoNoMes} onChange={e => setNewEmpFolgasDomingoNoMes(Number(e.target.value) || 0)} placeholder="Folgas de domingo por mês (Ex: 2)" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              <input type="number" min={1} max={80} value={newEmpCargaHoraria} onChange={e => setNewEmpCargaHoraria(Number(e.target.value) || 40)} placeholder="Carga horária semanal (Ex: 40)" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Habilidades</p>
                <div className="grid grid-cols-2 gap-2">
                  {SKILL_OPTIONS.map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className={`rounded-xl border px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${newEmpHabilidades.includes(skill) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Dias de trabalho</p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleWorkDay(day.value)}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${newEmpDiasTrabalho.includes(day.value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim disabled:opacity-60">
                {isSubmitting ? 'Salvando...' : (editingEmployeeId ? 'Salvar Alterações' : 'Cadastrar')}
              </button>
              {editingEmployeeId && (
                <button type="button" onClick={cancelEdit} className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:bg-surface-container">
                  Cancelar edição
                </button>
              )}
            </form>
          </motion.div>
        </div>
      )}

      {createdCredentials && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-60 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatedCredentials(null); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">{createdCredentials.redefinida ? 'Senha Redefinida' : 'Credenciais Criadas'}</h3>
              <button type="button" onClick={() => setCreatedCredentials(null)} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Nome</p>
                <p className="text-sm font-bold text-on-surface">{createdCredentials.name}</p>
              </div>
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">E-mail</p>
                <p className="text-sm font-bold text-on-surface break-all">{createdCredentials.email}</p>
              </div>
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Senha provisória (anote agora: não será exibida de novo)</p>
                <p className="text-sm font-bold text-on-surface">{createdCredentials.password}</p>
              </div>
              <p className="text-xs text-on-surface-variant">
                {createdCredentials.redefinida
                  ? 'A senha anterior deixou de valer e as sessões abertas desse usuário foram encerradas. Entregue a nova senha a ele.'
                  : 'Guarde essas credenciais para acesso do novo usuário.'}
              </p>
            </div>
            <button type="button" onClick={() => setCreatedCredentials(null)} className="w-full mt-5 bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-all">
              Fechar
            </button>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(employeeToResetPassword)}
        title="Redefinir senha?"
        description={`Uma senha provisória nova será gerada para ${employeeToResetPassword?.name ?? 'o profissional'}. A senha atual deixa de valer e as sessões abertas são encerradas.`}
        confirmLabel="Redefinir"
        cancelLabel="Cancelar"
        icon="lock_reset"
        isSubmitting={isResettingPassword}
        confirmingLabel="Redefinindo..."
        onClose={() => { if (!isResettingPassword) setEmployeeToResetPassword(null); }}
        onConfirm={async () => {
          const alvo = employeeToResetPassword;
          if (!alvo || isResettingPassword) return;
          setIsResettingPassword(true);
          const senhaProvisoria = gerarSenhaProvisoria();
          try {
            const resultado = await onEditEmployee(alvo.id, { password: senhaProvisoria });
            if (typeof resultado === 'string') { setErrorMessage(resultado); return; }
            if (resultado === false) return;
            setCreatedCredentials({ name: alvo.name, email: alvo.email, password: senhaProvisoria, redefinida: true });
          } catch (error) {
            const detalhe = error instanceof Error ? error.message : 'Não foi possível redefinir a senha.';
            // Erro respondido pela API = nada mudou; sem resposta (rede) não dá para saber se o servidor aplicou
            const semResposta = !isApiError(error) || error.code === 'NETWORK_ERROR';
            setErrorMessage(!semResposta
              ? detalhe
              : `${detalhe} A senha pode ter sido alterada mesmo assim: redefina de novo para obter uma senha visível.`);
          } finally {
            setIsResettingPassword(false);
            setEmployeeToResetPassword(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(employeeToDelete)}
        title="Excluir Colaborador?"
        description="Atendimentos futuros serão cancelados. Quem já tem histórico é apenas removido da equipe, e os atendimentos passados são preservados."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        icon="person_remove"
        onClose={() => setEmployeeToDelete(null)}
        onConfirm={async () => {
          if (!employeeToDelete) return;
          try {
            const resposta = await onDeleteEmployee(employeeToDelete) as { mensagem?: string } | undefined;
            setEmployeeToDelete(null);
            setToastMessage(resposta?.mensagem || 'Colaborador removido.');
          } catch (error) {
            setEmployeeToDelete(null);
            setErrorMessage(error instanceof Error ? error.message : 'Não foi possível remover o colaborador.');
          }
        }}
      />

      {showScheduleModal && selectedEmpForSchedule && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-50 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) closeScheduleModal(); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">Montar Escala</h3>
              <button type="button" onClick={closeScheduleModal} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1 custom-scrollbar">
              <div>
                <p className="text-sm font-bold text-on-surface mb-2">{selectedEmpForSchedule?.name}</p>
                <p className="text-xs text-on-surface-variant">{selectedEmpForSchedule?.specialty}</p>
              </div>

              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Edição em Lote (Bulk Edit)</p>
                  <button
                    type="button"
                    onClick={toggleSelectAllBulk}
                    className="text-[10px] font-bold uppercase tracking-widest text-primary hover:opacity-80"
                  >
                    {bulkSelectedEmployeeIds.length === selectableEmployees.length ? 'Limpar seleção' : 'Selecionar todos'}
                  </button>
                </div>

                <div className="max-h-32 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container p-2 custom-scrollbar">
                  {selectableEmployees.map((emp) => (
                    <label key={emp.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-container-high cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkSelectedEmployeeIds.includes(emp.id)}
                        onChange={() => toggleBulkSelection(emp.id)}
                        className="w-4 h-4 accent-primary"
                      />
                      <span className="text-xs text-on-surface truncate">{emp.name}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Data da Aplicação</label>
                    <input
                      type="date"
                      value={bulkTargetDate}
                      onChange={(e) => setBulkTargetDate(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Turno em Lote</label>
                    <select
                      value={bulkShiftSelection}
                      onChange={(e) => handleBulkShiftChange(e.target.value as '' | 'manha' | 'tarde' | 'folga')}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm"
                    >
                      <option value="">Escolha o turno...</option>
                      <option value="manha">Manhã (06:00 - 14:00)</option>
                      <option value="tarde">Tarde (14:00 - 22:00)</option>
                      <option value="folga">Folga</option>
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyBulkShift}
                  disabled={isApplyingBulkShift || bulkSelectedEmployeeIds.length === 0 || !bulkShiftSelection}
                  className="w-full bg-secondary text-on-secondary py-2.5 rounded-xl font-bold text-xs uppercase tracking-[0.18em] shadow-sm hover:opacity-90 disabled:opacity-60"
                >
                  {isApplyingBulkShift ? 'Aplicando...' : 'Aplicar em lote'}
                </button>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-3">Dias de Trabalho</p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleScheduleDay(day.value)}
                      className={`rounded-xl border px-2 py-2 text-[10px] font-bold uppercase tracking-widest transition-all ${scheduleDays.includes(day.value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              {turnos.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Preenchimento Rápido (Turnos)</p>
                  <div className="flex flex-wrap gap-2">
                    {turnos.map(t => (
                      <button key={t.id} type="button" onClick={() => { setScheduleHourStart(t.inicio); setScheduleHourEnd(t.fim); }} className="px-3 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-[11px] font-bold text-on-surface-variant transition-colors">
                        {t.nome} ({t.inicio} às {t.fim})
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Horário Início</label>
                  <input type="time" value={scheduleHourStart} onChange={e => setScheduleHourStart(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Horário Fim</label>
                  <input type="time" value={scheduleHourEnd} onChange={e => setScheduleHourEnd(e.target.value)} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
                </div>
              </div>

              <button type="button" onClick={handleSaveSchedule} className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-colors">
                Salvar Escala
              </button>
              <button type="button" onClick={closeScheduleModal} className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:bg-surface-container">
                Cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}