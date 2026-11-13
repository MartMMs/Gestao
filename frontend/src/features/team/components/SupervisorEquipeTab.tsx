import React, { useMemo, useRef, useState } from 'react';
import { horarioParaMinutos } from '@shared/agenda';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { motion } from 'motion/react';
import { Employee, Role, EmployeeUpdate } from '../../../types';
import { useAuth } from '../../../AuthContext';
import { isApiError, useAddTurno, useDeleteTurno, useServices, useTurnos } from '../../../api';
import { useSearch } from '../../../hooks/useSearch';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { confirmarSaida, useAlterado, useModal } from '../../../hooks/useModal';
import { isTeamMember, gerarSenhaProvisoria } from '../../../utils/formatters';
import { MENSAGEM_USUARIO_INVALIDO, USUARIO_REGEX } from '@shared/validadores';

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

// "Hoje" no fuso do negócio (Brasília), igual ao resto do sistema
const getTodayLocalDate = getLocalTodayString;

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
  const [newEmpUsuario, setNewEmpUsuario] = useState('');
  // Valores gravados da conta em edição: só vai para a API o que de fato mudou (e-mail antigo com maiúsculas,
  // intocado, não conta como troca de credencial)
  const [credenciaisOriginais, setCredenciaisOriginais] = useState({ email: '', usuario: '' });
  const [newEmpSenhaAtual, setNewEmpSenhaAtual] = useState('');
  const [newEmpCargo, setNewEmpCargo] = useState('');
  const [newEmpTipoEscala, setNewEmpTipoEscala] = useState<Employee['tipoEscala']>('6x1');
  // number | '' para o campo poder ficar vazio enquanto a pessoa redigita (o valor é validado ao salvar)
  // Caixinha "Informar horário de trabalho": desmarcada, o profissional segue o horário da casa
  const [informarHorario, setInformarHorario] = useState(false);
  const [newEmpEntrada, setNewEmpEntrada] = useState('08:00');
  const [newEmpSaida, setNewEmpSaida] = useState('17:00');
  const [newEmpFolgasDomingoNoMes, setNewEmpFolgasDomingoNoMes] = useState<number | ''>(2);
  const [newEmpCargaHoraria, setNewEmpCargaHoraria] = useState<number | ''>(40);
  const [newEmpHabilidades, setNewEmpHabilidades] = useState<string[]>([]);
  const [newEmpRole, setNewEmpRole] = useState<Role>('collaborator');
  const { currentUser, token } = useAuth();
  const { data: servicos } = useServices(token);
  const podeGerenciarSupervisores = currentUser?.role === 'admin';
  const [newEmpDiasTrabalho, setNewEmpDiasTrabalho] = useState<string[]>(['1','2','3','4','5','6']);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null);
  const [reallocateToId, setReallocateToId] = useState('');
  const [isDeletingEmployee, setIsDeletingEmployee] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [employeeCurrentPage, setEmployeeCurrentPage] = useState(1);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedEmpForSchedule, setSelectedEmpForSchedule] = useState<Employee | null>(null);
  const [scheduleDays, setScheduleDays] = useState<string[]>(['1','2','3','4','5','6']);
  const [bulkSelectedEmployeeIds, setBulkSelectedEmployeeIds] = useState<string[]>([]);
  // '' (nada), 'folga' ou o horário de um turno padrão ("HH:MM-HH:MM", como a escala grava)
  const [bulkShiftSelection, setBulkShiftSelection] = useState<string>('');
  const [bulkTargetDate, setBulkTargetDate] = useState(getTodayLocalDate());
  const [isApplyingBulkShift, setIsApplyingBulkShift] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; login: string; password: string; redefinida?: boolean } | null>(null);
  const [employeeToResetPassword, setEmployeeToResetPassword] = useState<Employee | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  // Própria senha não se redefine aqui (derrubaria a sessão antes de mostrar a nova); supervisor só redefine quem não é supervisor/admin
  // Mesma regra da API: só admin mexe em contas de supervisor/admin (a própria conta cada um edita)
  const podeGerenciarConta = (emp: Employee) => podeGerenciarSupervisores || (emp.role !== 'supervisor' && emp.role !== 'admin');
  const podeRedefinirSenha = (emp: Employee) => emp.id !== currentUser?.id && podeGerenciarConta(emp);
  const EMPLOYEES_PER_PAGE = 6;
  // Habilidades que valem alguma coisa: as exigidas pelos serviços (regra "Somente habilidades") e as já usadas na
  // equipe. Nada fixo de um ramo de negócio
  const SKILL_OPTIONS = useMemo(() => Array.from(new Set([
    ...(servicos ?? []).flatMap((s) => s.habilidadesPermitidas ?? []),
    ...employees.flatMap((e) => e.habilidades ?? []),
  ].map((h) => h.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [servicos, employees]);
  const selectableEmployees = useMemo(() => employees.filter(isTeamMember), [employees]);

  // --- ESTADOS DA GESTÃO DE TURNOS ---
  const [activeSubTab, setActiveSubTab] = useState<'profissionais' | 'gestao'>('profissionais');
  const { data: turnos = [] } = useTurnos(token);
  const { mutateAsync: criarTurno, isPending: criandoTurno } = useAddTurno(token);
  const { mutateAsync: excluirTurno, isPending: excluindoTurno } = useDeleteTurno(token);
  const [turnoParaExcluir, setTurnoParaExcluir] = useState<{ id: string; nome: string } | null>(null);
  // Trava síncrona: o isPending só chega no próximo render, tarde para segurar um duplo clique
  const enviandoTurno = useRef(false);
  const [novoTurnoNome, setNovoTurnoNome] = useState('');
  const [novoTurnoInicio, setNovoTurnoInicio] = useState('08:00');
  const [novoTurnoFim, setNovoTurnoFim] = useState('18:00');

  const handleAddTurno = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoTurno.current) return;
    enviandoTurno.current = true;
    try {
      await criarTurno({ nome: novoTurnoNome.trim(), inicio: novoTurnoInicio, fim: novoTurnoFim });
      setNovoTurnoNome('');
      setToastMessage('Turno adicionado.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível criar o turno.');
    } finally {
      enviandoTurno.current = false;
    }
  };

  const confirmarExclusaoTurno = async () => {
    if (!turnoParaExcluir || enviandoTurno.current) return;
    enviandoTurno.current = true;
    try {
      await excluirTurno(turnoParaExcluir.id);
      setToastMessage(`Turno "${turnoParaExcluir.nome}" excluído.`);
      setTurnoParaExcluir(null);
    } catch (error) {
      setTurnoParaExcluir(null);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir o turno.');
    } finally {
      enviandoTurno.current = false;
    }
  };

  // Duração em horas; fim antes do início = turno que vira a noite
  const duracaoTurno = (inicio: string, fim: string) => {
    const minutos = (horarioParaMinutos(fim) - horarioParaMinutos(inicio) + 1440) % 1440;
    return `${Math.floor(minutos / 60)}h${minutos % 60 ? String(minutos % 60).padStart(2, '0') : ''}`;
  };



  const filteredEmployees = useSearch(
    employees,
    searchTerm,
    emp => [emp.name, emp.usuario ?? '', emp.email, emp.specialty, emp.role]
  );

  const emailAlterado = Boolean(editingEmployeeId) && newEmpEmail.trim().toLowerCase() !== credenciaisOriginais.email.toLowerCase();
  const usuarioAlterado = Boolean(editingEmployeeId) && newEmpUsuario.trim().toLowerCase() !== credenciaisOriginais.usuario;
  // Trocar usuário ou e-mail da própria conta exige a senha atual (a API recusa sem ela)
  const editandoPropriaConta = Boolean(editingEmployeeId) && editingEmployeeId === currentUser?.id;
  const pedeSenhaAtual = editandoPropriaConta && (emailAlterado || usuarioAlterado);
  // Conta antiga (só com e-mail) pode seguir sem usuário; quem não tem e-mail precisa de usuário
  const exigeUsuario = !editingEmployeeId || !newEmpEmail.trim();

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    // Erro da tentativa anterior sai: a mesma mensagem de novo volta a aparecer (e um acerto não fica com erro velho)
    setErrorMessage(null);
    // Contas antigas (criadas só com e-mail) podem ser editadas sem usuário: entram pelo e-mail
    if (!newEmpName.trim() || !newEmpCargo.trim() || (exigeUsuario && !newEmpUsuario.trim())) {
      setErrorMessage('Preencha o nome, o usuário de acesso e o cargo.');
      return;
    }
    if (newEmpCargaHoraria === '' || !Number.isInteger(newEmpCargaHoraria) || newEmpCargaHoraria < 1 || newEmpCargaHoraria > 44) {
      setErrorMessage('Carga horária semanal deve ser um número inteiro entre 1 e 44 horas.');
      return;
    }
    if (newEmpFolgasDomingoNoMes === '' || !Number.isInteger(newEmpFolgasDomingoNoMes) || newEmpFolgasDomingoNoMes < 0 || newEmpFolgasDomingoNoMes > 5) {
      setErrorMessage('Folgas aos domingos no mês deve ser um número inteiro entre 0 e 5.');
      return;
    }
    
    setIsSubmitting(true);
    let success: boolean | string | void = false;

    try {
      if (editingEmployeeId) {
        success = await onEditEmployee(editingEmployeeId, {
          name: newEmpName,
          // Especialidade não vai: o formulário não a mostra, e reenviar o cargo nela apagaria a gravada
          ...(emailAlterado ? { email: newEmpEmail.trim() } : {}),
          ...(usuarioAlterado ? { usuario: newEmpUsuario.trim() } : {}),
          ...(pedeSenhaAtual ? { senhaAtual: newEmpSenhaAtual } : {}),
          cargo: newEmpCargo.trim(),
          tipoEscala: newEmpTipoEscala,
          turnoPadrao: informarHorario ? `${newEmpEntrada}-${newEmpSaida}` : null,
          folgasDomingoNoMes: newEmpFolgasDomingoNoMes,
          cargaHorariaSemanal: newEmpCargaHoraria,
          habilidades: newEmpHabilidades,
          role: newEmpRole,
          diasTrabalho: newEmpDiasTrabalho.join(','),
        });
        if (typeof success === 'string') { setErrorMessage(success); success = false; }
        else if (success !== false) { setToastMessage(pedeSenhaAtual ? `Dados de acesso atualizados. No próximo login, entre com ${newEmpUsuario.trim().toLowerCase() || newEmpEmail.trim().toLowerCase()}.` : 'Colaborador atualizado com sucesso!'); }
      } else {
        const senhaProvisoria = gerarSenhaProvisoria();
        success = await onAddEmployee({
          name: newEmpName,
          email: newEmpEmail.trim(),
          usuario: newEmpUsuario.trim(),
          password: senhaProvisoria,
          role: newEmpRole,
          specialty: '',
          cargo: newEmpCargo.trim(),
          tipoEscala: newEmpTipoEscala,
          turnoPadrao: informarHorario ? `${newEmpEntrada}-${newEmpSaida}` : null,
          folgasDomingoNoMes: newEmpFolgasDomingoNoMes,
          cargaHorariaSemanal: newEmpCargaHoraria,
          habilidades: newEmpHabilidades,
          diasTrabalho: newEmpDiasTrabalho.join(','),
          avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${newEmpName}`,
        });
        if (typeof success === 'string') { setErrorMessage(success); success = false; }
        else if (success !== false) {
          setToastMessage('Colaborador adicionado com sucesso!');
          setCreatedCredentials({ name: newEmpName, login: newEmpUsuario.trim().toLowerCase() || newEmpEmail.trim().toLowerCase(), password: senhaProvisoria });
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

  // Estado inicial do formulário (criar) ou valores da conta (editar): um lugar só, para nenhum campo ficar para trás
  const preencherFormulario = (emp?: Employee) => {
    setEditingEmployeeId(emp?.id ?? null);
    setNewEmpName(emp?.name ?? '');
    setNewEmpEmail(emp?.email ?? '');
    setNewEmpUsuario(emp?.usuario ?? '');
    setCredenciaisOriginais({ email: emp?.email ?? '', usuario: emp?.usuario ?? '' });
    setNewEmpSenhaAtual('');
    setNewEmpCargo(emp ? emp.cargo || emp.specialty || '' : '');
    setNewEmpTipoEscala(emp?.tipoEscala || '6x1');
    setInformarHorario(Boolean(emp?.turnoPadrao));
    setNewEmpEntrada(emp?.turnoPadrao?.slice(0, 5) || '08:00');
    setNewEmpSaida(emp?.turnoPadrao?.slice(6) || '17:00');
    setNewEmpFolgasDomingoNoMes(emp?.folgasDomingoNoMes ?? 2);
    setNewEmpCargaHoraria(emp?.cargaHorariaSemanal ?? 40);
    setNewEmpHabilidades(emp?.habilidades || []);
    setNewEmpRole(emp?.role ?? 'collaborator');
    setNewEmpDiasTrabalho((emp?.diasTrabalho || '1,2,3,4,5,6').split(','));
  };

  const cancelEdit = () => {
    setErrorMessage(null);
    preencherFormulario();
    setShowEmployeeForm(false);
  };

  const openCreateEmployeeForm = () => {
    preencherFormulario();
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

  const handleBulkShiftChange = (value: string) => {
    setBulkShiftSelection(value);
  };
  const nomeDoTurnoEmLote = () => turnos.find((t) => `${t.inicio}-${t.fim}` === bulkShiftSelection)?.nome ?? bulkShiftSelection;

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

      return {
        colaboradorId: employeeId,
        data: bulkTargetDate,
        tipo: 'trabalho' as const,
        turno: bulkShiftSelection,
        descricao: `Aplicação em lote (${nomeDoTurnoEmLote()})`,
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

      const shiftLabel = bulkShiftSelection === 'folga' ? 'Folga' : nomeDoTurnoEmLote();
      setToastMessage(`Escala em lote aplicada (${shiftLabel}) para ${bulkSelectedEmployeeIds.length} colaborador(es).`);
      closeScheduleModal();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao aplicar turno em lote.');
    } finally {
      setIsApplyingBulkShift(false);
    }
  };

  const handleSaveSchedule = async () => {
    if (!selectedEmpForSchedule || scheduleDays.length === 0) {
      setErrorMessage('Escolha pelo menos um dia de trabalho.');
      return;
    }
    if (isSavingSchedule) return;
    setIsSavingSchedule(true);

    try {
      const success = await onEditEmployee(selectedEmpForSchedule.id, {
        diasTrabalho: scheduleDays.join(','),
      });
      if (typeof success === 'string') {
        setErrorMessage(success);
      } else if (success !== false) {
        setToastMessage('Dias de trabalho atualizados.');
        closeScheduleModal();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro ao salvar escala.');
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const paginatedEmployees = useMemo(() => {
    const start = (employeeCurrentPage - 1) * EMPLOYEES_PER_PAGE;
    return filteredEmployees.slice(start, start + EMPLOYEES_PER_PAGE);
  }, [filteredEmployees, employeeCurrentPage]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEES_PER_PAGE));

  // Uma função de fechar por modal (X, clique fora e Esc): não fecha durante o envio e pergunta se algo mudou.
  // "Cancelar edição" descarta de propósito, sem perguntar
  const formAlterado = useAlterado(showEmployeeForm, [newEmpName, newEmpEmail, newEmpUsuario, newEmpCargo, newEmpTipoEscala, newEmpFolgasDomingoNoMes, newEmpCargaHoraria, newEmpHabilidades, newEmpRole, newEmpDiasTrabalho]);
  const fecharForm = () => { if (!isSubmitting && confirmarSaida(formAlterado)) cancelEdit(); };
  const escalaAberta = showScheduleModal && !!selectedEmpForSchedule;
  const escalaAlterada = useAlterado(escalaAberta, [scheduleDays, bulkSelectedEmployeeIds, bulkShiftSelection, bulkTargetDate]);
  const fecharEscala = () => { if (!isApplyingBulkShift && !isSavingSchedule && confirmarSaida(escalaAlterada)) closeScheduleModal(); };
  useModal(showEmployeeForm, fecharForm);
  useModal(!!createdCredentials, () => setCreatedCredentials(null));
  useModal(escalaAberta, fecharEscala);

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
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-sm font-bold text-on-surface truncate">{emp.name}</h4>
                      {/* Função de acesso visível: dá para saber quem é supervisor ou recepção sem abrir o cadastro */}
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${emp.role === 'admin' || emp.role === 'supervisor' ? 'bg-primary/15 text-primary' : emp.role === 'receptionist' ? 'bg-amber-500/15 text-amber-700' : 'bg-surface-container text-on-surface-variant'}`}>
                        {emp.role === 'admin' ? 'Admin' : emp.role === 'supervisor' ? 'Supervisor' : emp.role === 'receptionist' ? 'Recepção' : 'Colaborador'}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant truncate">{[emp.usuario, emp.email].filter(Boolean).join(' · ')}</p>
                    <p className="text-[11px] uppercase tracking-widest text-primary mt-1">{emp.specialty}</p>
                    <p className="text-[11px] text-on-surface-variant mt-1">{emp.tipoEscala || '6x1'} • {emp.cargaHorariaSemanal ?? 40}h/sem</p>
                    <p className="text-[11px] text-on-surface-variant">Domingos de folga/mês: {emp.folgasDomingoNoMes ?? 2}</p>
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
                  {onViewEmployee && <button
                    onClick={() => onViewEmployee(emp)}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                    title="Perfil (RH)"
                  >
                    <span className="material-symbols-outlined text-[20px]">badge</span>
                  </button>}
                  {(podeGerenciarConta(emp) || emp.id === currentUser?.id) && <button
                    onClick={() => {
                      preencherFormulario(emp);
                      setShowEmployeeForm(true);
                    }}
                    className="p-2 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-full"
                    title="Editar"
                  >
                    <span className="material-symbols-outlined text-[20px]">edit</span>
                  </button>}
                  {podeGerenciarConta(emp) && emp.id !== currentUser?.id && <button
                    onClick={() => setEmployeeToDelete(emp.id)}
                    className="p-2 text-on-surface-variant hover:bg-error-container/20 hover:text-error rounded-full"
                    title="Excluir"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>}
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
        <section aria-labelledby="turnos-titulo" className="max-w-3xl bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm space-y-6">
          <header>
            <h3 id="turnos-titulo" className="text-lg font-headline text-on-surface">Turnos padrão</h3>
            <p className="text-sm text-on-surface-variant">Aparecem como opções ao editar um dia da escala e na edição em lote. Excluir um turno não muda dias já marcados.</p>
          </header>

          <form onSubmit={handleAddTurno} className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
            <label className="text-xs font-bold text-on-surface-variant">
              Nome
              <input type="text" value={novoTurnoNome} onChange={e => setNovoTurnoNome(e.target.value)} placeholder="Ex.: Madrugada" maxLength={40} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
            </label>
            <label className="text-xs font-bold text-on-surface-variant">
              Início
              <input type="time" value={novoTurnoInicio} onChange={e => setNovoTurnoInicio(e.target.value)} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
            </label>
            <label className="text-xs font-bold text-on-surface-variant">
              Fim
              <input type="time" value={novoTurnoFim} onChange={e => setNovoTurnoFim(e.target.value)} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
            </label>
            <button type="submit" disabled={criandoTurno} className="h-11 px-5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary-dim disabled:opacity-60">
              {criandoTurno ? 'Salvando...' : 'Adicionar'}
            </button>
          </form>

          {turnos.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Nenhum turno cadastrado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-on-surface-variant border-b border-outline-variant/20">
                  <th scope="col" className="py-2 font-bold">Nome</th>
                  <th scope="col" className="py-2 font-bold">Horário</th>
                  <th scope="col" className="py-2 font-bold">Duração</th>
                  <th scope="col" className="py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {turnos.map(turno => (
                  <tr key={turno.id} className="border-b border-outline-variant/10 last:border-0">
                    <td className="py-3 font-bold text-on-surface">{turno.nome}</td>
                    <td className="py-3 tabular-nums text-on-surface">{turno.inicio} – {turno.fim}{turno.fim < turno.inicio ? ' (dia seguinte)' : ''}</td>
                    <td className="py-3 tabular-nums text-on-surface-variant">{duracaoTurno(turno.inicio, turno.fim)}</td>
                    <td className="py-3 text-right">
                      <button type="button" onClick={() => setTurnoParaExcluir({ id: turno.id, nome: turno.nome })} aria-label={`Excluir turno ${turno.nome}`} className="p-2 rounded-full text-on-surface-variant hover:text-error hover:bg-error/10">
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {showEmployeeForm && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-50 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) fecharForm(); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" role="dialog" aria-modal="true" aria-label={editingEmployeeId ? 'Editar Colaborador' : 'Criar Usuário'} onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">{editingEmployeeId ? 'Editar Colaborador' : 'Criar Usuário'}</h3>
              <button type="button" onClick={fecharForm} disabled={isSubmitting} aria-label="Fechar" className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant disabled:opacity-40"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
            </div>
            {/* Envio barrado pelo navegador (campo inválido): o erro da tentativa anterior sai, para não parecer o atual */}
            <form onSubmit={handleAddEmployee} onInvalidCapture={() => setErrorMessage(null)} className="space-y-3 max-h-[78vh] overflow-y-auto pr-1 custom-scrollbar">
              <div>
                <label htmlFor="emp-nome" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Nome</label>
                <input id="emp-nome" required type="text" value={newEmpName} onChange={e => setNewEmpName(e.target.value)} placeholder="Nome" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              </div>
              <div>
                <label htmlFor="emp-usuario" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Usuário de acesso</label>
                <input id="emp-usuario" required={exigeUsuario} type="text" value={newEmpUsuario} onChange={e => setNewEmpUsuario(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="Usuário de acesso (ex.: joao.silva)" autoComplete="off" autoCapitalize="none" spellCheck={false} pattern={USUARIO_REGEX.source} title={MENSAGEM_USUARIO_INVALIDO} maxLength={40} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
                <p className="mt-1 text-[11px] text-on-surface-variant">{editingEmployeeId && exigeUsuario ? 'Sem e-mail, o usuário de acesso é obrigatório: é com ele que a pessoa entra.' : 'É com ele (e a senha) que a pessoa entra no sistema.'}</p>
              </div>
              <div>
                <label htmlFor="emp-email" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">E-mail (opcional)</label>
                <input id="emp-email" type="email" value={newEmpEmail} onChange={e => setNewEmpEmail(e.target.value)} placeholder="E-mail (opcional)" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              </div>
              {pedeSenhaAtual && (
                <div>
                  <label htmlFor="emp-senha-atual" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Sua senha atual</label>
                  <input id="emp-senha-atual" required type="password" value={newEmpSenhaAtual} onChange={e => setNewEmpSenhaAtual(e.target.value)} placeholder="Sua senha atual" autoComplete="current-password" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
                  <p className="mt-1 text-[11px] text-on-surface-variant">Para trocar o seu próprio usuário ou e-mail, confirme a sua senha. Você continua conectado aqui; as sessões em outros aparelhos serão encerradas.</p>
                </div>
              )}
              {/* Cargo: regras de serviço ("Somente cargos: ...") e, quando a especialidade era o próprio cargo, o rótulo da lista e do totem */}
              <div>
                <label htmlFor="emp-cargo" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Cargo</label>
                <input id="emp-cargo" required type="text" value={newEmpCargo} onChange={e => setNewEmpCargo(e.target.value)} placeholder="Cargo (ex.: Massagista)" maxLength={60} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              </div>
              {/* A função de acesso define o que a pessoa pode fazer no sistema */}
              <div>
                <label htmlFor="emp-role" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Função de acesso</label>
                {/* A própria função não muda aqui (a API recusa): evita se rebaixar sem querer */}
                <select id="emp-role" value={newEmpRole} onChange={e => setNewEmpRole(e.target.value as Role)} disabled={editandoPropriaConta} title={editandoPropriaConta ? 'A sua própria função de acesso só pode ser mudada por um administrador.' : undefined} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm disabled:opacity-60">
                  <option value="collaborator">Colaborador</option>
                  <option value="receptionist">Recepção</option>
                  {/* Só administradores criam ou promovem supervisores (a API recusa os demais) */}
                  {(podeGerenciarSupervisores || newEmpRole === 'supervisor') && <option value="supervisor">Supervisor</option>}
                  {/* Admin promove outro admin (a API só aceita de admin); na conta admin a opção precisa existir para o select não mostrar "Colaborador" */}
                  {(podeGerenciarSupervisores || newEmpRole === 'admin') && <option value="admin">Administrador</option>}
                </select>
              </div>
              <div>
                <label htmlFor="emp-tipo-escala" className="block text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Tipo de escala</label>
                <select id="emp-tipo-escala" value={newEmpTipoEscala || '6x1'} onChange={e => setNewEmpTipoEscala(e.target.value as Employee['tipoEscala'])} className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm">
                  <option value="6x1">6x1 (6 dias trab, 1 folga)</option>
                  <option value="5x1">5x1 (5 dias trab, 1 folga)</option>
                  <option value="5x2">5x2 (5 dias trab, 2 folgas)</option>
                  <option value="12x36">12x36 (12h trab, 36h folga)</option>
                  <option value="rotativo">Rotativo (3 turnos)</option>
                </select>
              </div>
              <div className="rounded-xl border border-outline-variant/20 p-3">
                <label className="flex items-center gap-2 text-sm text-on-surface">
                  <input type="checkbox" checked={informarHorario} onChange={e => setInformarHorario(e.target.checked)} />
                  Informar horário de trabalho
                </label>
                {informarHorario ? (
                  <div className="mt-3 flex items-end gap-3">
                    <label className="flex-1 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Entrada
                      <input type="time" required value={newEmpEntrada} onChange={e => setNewEmpEntrada(e.target.value)} className="block mt-1 w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm" />
                    </label>
                    <label className="flex-1 text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Saída
                      <input type="time" required value={newEmpSaida} onChange={e => setNewEmpSaida(e.target.value)} className="block mt-1 w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-2 text-sm" />
                    </label>
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] text-on-surface-variant">Sem horário, os dias de trabalho seguem o horário da casa.</p>
                )}
                {informarHorario && newEmpSaida < newEmpEntrada && (
                  <p role="status" className="mt-2 text-[11px] font-bold text-error">Saída antes da entrada: vira turno noturno, terminando às {newEmpSaida} do dia seguinte. Confira se não inverteu os horários.</p>
                )}
                {informarHorario && <p className="mt-2 text-[11px] text-on-surface-variant">Com a regra de turno acima, os dias de trabalho aparecem com esse horário no calendário do RH e na Timeline. Um ajuste feito num dia tem prioridade.</p>}
              </div>
              <input type="number" min={0} max={5} value={newEmpFolgasDomingoNoMes} onChange={e => setNewEmpFolgasDomingoNoMes(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Folgas de domingo por mês (Ex: 2)" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              <input type="number" min={1} max={44} value={newEmpCargaHoraria} onChange={e => setNewEmpCargaHoraria(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Carga horária semanal (Ex: 40)" className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Habilidades</p>
                <div className="grid grid-cols-2 gap-2">
                  {SKILL_OPTIONS.map((skill) => (
                    <button
                      key={skill}
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      aria-pressed={newEmpHabilidades.includes(skill)}
                      className={`rounded-xl border px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-all ${newEmpHabilidades.includes(skill) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {skill}
                    </button>
                  ))}
                </div>
                {SKILL_OPTIONS.length === 0 && (
                  <p className="text-[11px] text-on-surface-variant">Nenhuma habilidade cadastrada ainda. Elas aparecem aqui quando um serviço exige habilidades (regra "Somente habilidades").</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Dias de trabalho</p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleWorkDay(day.value)}
                      aria-pressed={newEmpDiasTrabalho.includes(day.value)}
                      className={`rounded-xl border px-2 py-2 text-[11px] font-bold uppercase tracking-widest transition-all ${newEmpDiasTrabalho.includes(day.value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
              <button disabled={isSubmitting} type="submit" className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim disabled:opacity-60">
                {editingEmployeeId ? (isSubmitting ? 'Salvando...' : 'Salvar Alterações') : (isSubmitting ? 'Cadastrando...' : 'Cadastrar')}
              </button>
              {editingEmployeeId && (
                <button type="button" onClick={cancelEdit} disabled={isSubmitting} className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:bg-surface-container">
                  Cancelar edição
                </button>
              )}
            </form>
          </motion.div>
        </div>
      )}

      {createdCredentials && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-60 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatedCredentials(null); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" role="dialog" aria-modal="true" aria-label="Credenciais" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">{createdCredentials.redefinida ? 'Senha Redefinida' : 'Credenciais Criadas'}</h3>
              <button type="button" onClick={() => setCreatedCredentials(null)} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="space-y-3">
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Nome</p>
                <p className="text-sm font-bold text-on-surface">{createdCredentials.name}</p>
              </div>
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">{createdCredentials.login.includes('@') ? 'E-mail de acesso' : 'Usuário de acesso'}</p>
                <p className="text-sm font-bold text-on-surface break-all">{createdCredentials.login}</p>
              </div>
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-1">Senha provisória (anote agora: não será exibida de novo)</p>
                <p className="text-sm font-bold text-on-surface">{createdCredentials.password}</p>
              </div>
              <p className="text-xs text-on-surface-variant">
                {createdCredentials.redefinida
                  ? 'A senha anterior deixou de valer e as sessões abertas desse usuário foram encerradas. Entregue a nova senha a ele: no próximo acesso ele vai criar uma senha própria.'
                  : 'Entregue essas credenciais ao novo usuário: no primeiro acesso ele vai criar uma senha própria.'}
              </p>
            </div>
            <button type="button" onClick={() => setCreatedCredentials(null)} className="w-full mt-5 bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-all">
              Fechar
            </button>
          </motion.div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(turnoParaExcluir)}
        title={`Excluir o turno ${turnoParaExcluir?.nome ?? ''}?`}
        description="Ele some das opções da escala. Dias já marcados com esse horário não mudam."
        confirmLabel="Excluir"
        confirmingLabel="Excluindo..."
        cancelLabel="Manter turno"
        icon="delete"
        isSubmitting={excluindoTurno}
        onClose={() => { if (!excluindoTurno) setTurnoParaExcluir(null); }}
        onConfirm={confirmarExclusaoTurno}
      />

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
            setCreatedCredentials({ name: alvo.name, login: alvo.usuario || alvo.email, password: senhaProvisoria, redefinida: true });
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
        description="Escolha quem assume os atendimentos futuros; sem escolha, eles são cancelados. Quem já tem histórico é apenas removido da equipe, e os atendimentos passados são preservados."
        confirmLabel="Excluir"
        confirmingLabel="Excluindo..."
        cancelLabel="Cancelar"
        icon="person_remove"
        isSubmitting={isDeletingEmployee}
        onClose={() => { if (!isDeletingEmployee) { setEmployeeToDelete(null); setReallocateToId(''); } }}
        onConfirm={async () => {
          if (!employeeToDelete || isDeletingEmployee) return;
          setIsDeletingEmployee(true);
          try {
            const resposta = await onDeleteEmployee(employeeToDelete, reallocateToId || undefined) as { mensagem?: string } | undefined;
            setToastMessage(resposta?.mensagem || 'Colaborador removido.');
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Não foi possível remover o colaborador.');
          } finally {
            setIsDeletingEmployee(false);
            setEmployeeToDelete(null);
            setReallocateToId('');
          }
        }}
      >
        <label className="block text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2" htmlFor="realocar-para">
          Atendimentos futuros vão para
        </label>
        <select
          id="realocar-para"
          value={reallocateToId}
          onChange={(e) => setReallocateToId(e.target.value)}
          disabled={isDeletingEmployee}
          className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl p-3 text-sm mb-6"
        >
          <option value="">Ninguém (cancelar os atendimentos futuros)</option>
          {selectableEmployees.filter((emp) => emp.id !== employeeToDelete).map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
      </ConfirmDialog>

      {showScheduleModal && selectedEmpForSchedule && (
        <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-50 p-4 flex items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) fecharEscala(); }}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/10 shadow-2xl w-full max-w-lg" role="dialog" aria-modal="true" aria-label="Montar Escala" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-headline text-primary">Montar Escala</h3>
              <button type="button" onClick={fecharEscala} disabled={isApplyingBulkShift} aria-label="Fechar" className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant disabled:opacity-40"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
            </div>
            <div className="space-y-4 max-h-[72vh] overflow-y-auto pr-1 custom-scrollbar">
              <div>
                <p className="text-sm font-bold text-on-surface mb-2">{selectedEmpForSchedule?.name}</p>
                <p className="text-xs text-on-surface-variant">{selectedEmpForSchedule?.specialty}</p>
              </div>

              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Edição em Lote (Bulk Edit)</p>
                  <button
                    type="button"
                    onClick={toggleSelectAllBulk}
                    className="text-[11px] font-bold uppercase tracking-widest text-primary hover:opacity-80"
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
                    <label className="block text-[11px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Data da Aplicação</label>
                    <input
                      type="date"
                      value={bulkTargetDate}
                      onChange={(e) => setBulkTargetDate(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Turno em Lote</label>
                    <select
                      value={bulkShiftSelection}
                      onChange={(e) => handleBulkShiftChange(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm"
                    >
                      <option value="">Escolha o turno...</option>
                      {/* Turnos padrão (Regras e Turnos) */}
                      {turnos.map((t) => <option key={t.id} value={`${t.inicio}-${t.fim}`}>{t.nome} ({t.inicio} - {t.fim})</option>)}
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
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-3">Dias de Trabalho</p>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleScheduleDay(day.value)}
                      aria-pressed={scheduleDays.includes(day.value)}
                      className={`rounded-xl border px-2 py-2 text-[11px] font-bold uppercase tracking-widest transition-all ${scheduleDays.includes(day.value) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/20'}`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* O horário de cada dia (turno) é definido na aba Escala; aqui ficam só os dias de trabalho */}
              <p className="text-xs text-on-surface-variant">O horário de cada dia (turno) é definido na aba Escala.</p>

              <button type="button" onClick={handleSaveSchedule} disabled={isSavingSchedule || isApplyingBulkShift} className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-colors disabled:opacity-60">
                {isSavingSchedule ? 'Salvando...' : 'Salvar Escala'}
              </button>
              <button type="button" onClick={fecharEscala} disabled={isSavingSchedule || isApplyingBulkShift} className="w-full py-2 rounded-xl text-xs font-bold uppercase tracking-widest text-on-surface-variant hover:bg-surface-container disabled:opacity-40">
                Cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}