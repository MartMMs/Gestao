import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizarTexto } from '@shared/validadores';
import { horarioParaMinutos } from '@shared/agenda';
import { Appointment, Client, Employee, Service, ServiceEligibilityMode } from '../../../types';
import { getDuration } from '../utils/appointmentCore';
import { AnamneseForm, AnamneseData, initialAnamnese, formatAnamnese } from '../../../components/AnamneseForm';
import { AppointmentScheduleFields } from '../../../components/AppointmentScheduleFields';
import { AppointmentModalShell } from '../../../components/AppointmentModalShell';
import { formatAnamneseStorage, parseClientObservation } from '../../../utils/anamneseUtils';
import { formatPhone, formatCpf, isTeamMember } from '../../../utils/formatters';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { SCHEDULE_CONFIG } from '../../../config/scheduleConfig';
import { validateAppointmentScheduling } from '../utils/appointmentValidation';
import { isApiError } from '../../../api';

const normalizeSearch = normalizarTexto;

const normalizeEligibilityMode = (mode?: string): ServiceEligibilityMode => {
  if (mode === 'cargo' || mode === 'habilidade' || mode === 'livre') return mode;
  return 'livre';
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)));
};

const isEmployeeEligibleForService = (employee: Employee, service: Service): boolean => {
  const mode = normalizeEligibilityMode(service.modoElegibilidade);
  if (mode === 'livre') return true;

  if (mode === 'cargo') {
    const allowedCargos = normalizeStringList(service.cargosPermitidos).map((cargo) => normalizeSearch(cargo));
    if (allowedCargos.length === 0) return true;
    const employeeCargo = normalizeSearch(employee.cargo || employee.specialty || '');
    return allowedCargos.includes(employeeCargo);
  }

  const allowedSkills = normalizeStringList(service.habilidadesPermitidas).map((skill) => normalizeSearch(skill));
  if (allowedSkills.length === 0) return true;
  const employeeSkills = new Set((employee.habilidades || []).map((skill) => normalizeSearch(String(skill))));
  return allowedSkills.some((skill) => employeeSkills.has(skill));
};

type BookingDraft = {
  clientMode: 'search' | 'new';
  bookDate: string;
  bookName: string;
  bookPhone: string;
  bookCpf: string;
  bookTime: string;
  bookEmp: string;
  bookService: string[];
  serviceSearchTerm: string;
  bookDetails: string;
  bookClientObservation: string;
  selectedClientId?: string | null;
  showAnamnese?: boolean;
  anamneseData?: AnamneseData;
};

type BookingAppointmentPayload = Omit<Appointment, 'id' | 'status'> & {
  cpf?: string;
  clientId?: string;
  clientObservation?: string;
};

export interface BookingModalProps {
  receptionDate: string;
  initialTime: string;
  initialEmpId: string;
  clients: Client[];
  services: Service[];
  employees: Employee[];
  appointments: Appointment[];
  isAddingAppointment?: boolean;
  onClose: () => void;
  onAddAppointment: (appointment: BookingAppointmentPayload) => Promise<boolean | void> | void;
  onEditClient?: (id: string, clientData: Partial<Client>) => Promise<boolean | void> | void;
  setErrorMessage: (msg: string | null) => void;
  setToastMessage: (msg: string | null) => void;
}

export function BookingModal({ receptionDate, initialTime, initialEmpId, clients, services, employees, appointments, isAddingAppointment, onClose, onAddAppointment, setErrorMessage, setToastMessage }: BookingModalProps) {
  const initialDraft = useMemo<BookingDraft>(() => ({
    clientMode: 'search',
    bookDate: receptionDate,
    bookName: '',
    bookPhone: '',
    bookCpf: '',
    bookTime: initialTime,
    bookEmp: initialEmpId,
    bookService: [],
    serviceSearchTerm: '',
    bookDetails: '',
    bookClientObservation: '',
    selectedClientId: null,
    showAnamnese: false,
    anamneseData: initialAnamnese,
  }), [initialEmpId, initialTime, receptionDate]);

  // Rascunho por slot: um formulário abandonado nunca é restaurado em outro horário/profissional
  const { draft, setDraft, clearDraft } = useFormDraft<BookingDraft>(
    `booking-modal-draft:${receptionDate}:${initialTime}:${initialEmpId}`,
    initialDraft,
  );

  const [clientMode, setClientMode] = useState<'search' | 'new'>(() => draft.clientMode || 'search');
  const [bookDate, setBookDate] = useState(() => draft.bookDate || receptionDate);
  const [bookName, setBookName] = useState(() => draft.bookName || '');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [isClientSearchOpen, setIsClientSearchOpen] = useState(false);
  const [activeClientIndex, setActiveClientIndex] = useState(-1);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => draft.selectedClientId ?? null);
  const [bookPhone, setBookPhone] = useState(() => formatPhone(draft.bookPhone || ''));
  const [bookCpf, setBookCpf] = useState(() => formatCpf(draft.bookCpf || ''));
  const [bookTime, setBookTime] = useState(() => draft.bookTime || initialTime);
  const [bookEmp, setBookEmp] = useState(() => {
    const restoredBookEmp = draft.bookEmp || initialEmpId;
    const isRestoredEmpValid = employees.some((employee) => employee.id === restoredBookEmp && isTeamMember(employee));
    const fallbackEmployeeId = employees.find((employee) => employee.id === initialEmpId && isTeamMember(employee))?.id
      || employees.find((employee) => isTeamMember(employee))?.id
      || '';
    return isRestoredEmpValid ? restoredBookEmp : fallbackEmployeeId;
  });
  const [bookService, setBookService] = useState<string[]>(() => {
    return Array.isArray(draft.bookService)
      ? draft.bookService.filter((serviceName) => services.some((service) => service.nome === serviceName))
      : [];
  });
  const [serviceSearchTerm, setServiceSearchTerm] = useState(() => {
    const restoredServiceSearchTerm = draft.serviceSearchTerm || '';
    const normalizedSearchTerm = normalizeSearch(restoredServiceSearchTerm);
    const hasSearchMatch = !normalizedSearchTerm || services.some((service) => {
      const name = normalizeSearch(service.nome);
      const description = normalizeSearch(service.descricao || '');
      return name.includes(normalizedSearchTerm) || description.includes(normalizedSearchTerm);
    });
    return hasSearchMatch ? restoredServiceSearchTerm : '';
  });
  const [bookDetails, setBookDetails] = useState(() => draft.bookDetails || '');
  const [bookClientObservation, setBookClientObservation] = useState(() => draft.bookClientObservation || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [showAnamnese, setShowAnamnese] = useState(() => Boolean(draft.showAnamnese));
  const [anamneseData, setAnamneseData] = useState<AnamneseData>(() => draft.anamneseData ?? initialAnamnese);
  const clientSearchWrapperRef = useRef<HTMLDivElement | null>(null);
  const canShowBookingDetails = clientMode === 'new' || Boolean(selectedClientId);
  const bookingBusy = Boolean(isAddingAppointment || isSubmitting);

  useEffect(() => {
    setDraft({
      clientMode,
      bookDate,
      bookName,
      bookPhone,
      bookCpf,
      bookTime,
      bookEmp,
      bookService,
      serviceSearchTerm,
      bookDetails,
      bookClientObservation,
      selectedClientId,
      showAnamnese,
      anamneseData,
    });
  }, [
    clientMode,
    bookDate,
    bookName,
    bookPhone,
    bookCpf,
    bookTime,
    bookEmp,
    bookService,
    serviceSearchTerm,
    bookDetails,
    bookClientObservation,
    selectedClientId,
    showAnamnese,
    anamneseData,
    setDraft,
  ]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!clientSearchWrapperRef.current) return;
      const target = event.target as Node | null;
      if (target && !clientSearchWrapperRef.current.contains(target)) {
        setIsClientSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filteredClients = useMemo(() => {
    const q = normalizeSearch(clientSearchTerm);
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    const ranked = clients
      .map(client => {
        const name = normalizeSearch(client.nome);
        const phone = (client.telefone || '').replace(/\D/g, '');
        const cpf = (client.cpf || '').replace(/\D/g, '');
        // Sem dígitos na busca, só o nome conta (''.includes casaria com todo mundo)
        const matches = name.includes(q) || (digits.length > 0 && (phone.includes(digits) || cpf.includes(digits)));
        if (!matches) return null;

        let score = 0;
        if (q) {
          if (cpf === digits) score += 120;
          if (cpf.startsWith(digits) && digits.length > 0) score += 90;
          if (phone === digits) score += 80;
          if (phone.startsWith(digits) && digits.length > 0) score += 60;
          if (name.startsWith(q)) score += 50;
          if (name.includes(q)) score += 30;
          if (client.nome.toLowerCase().includes(clientSearchTerm.trim().toLowerCase())) score += 10;
        }

        return { client, score };
      })
      .filter((entry): entry is { client: Client; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score || a.client.nome.localeCompare(b.client.nome));

    return ranked.slice(0, 8).map(entry => entry.client);
  }, [clientSearchTerm, clients]);

  const filteredServices = useMemo(() => {
    const q = normalizeSearch(serviceSearchTerm);
    if (!q) return services;
    return services.filter(s => {
      const name = normalizeSearch(s.nome);
      const description = normalizeSearch(s.descricao || '');
      return name.includes(q) || description.includes(q);
    });
  }, [serviceSearchTerm, services]);

  const teamEmployees = useMemo(() => employees.filter((employee) => isTeamMember(employee)), [employees]);

  const selectedServiceDefinitions = useMemo(() => {
    if (bookService.length === 0) return [] as Service[];
    return services.filter((service) => bookService.includes(service.nome));
  }, [bookService, services]);

  const eligibleEmployees = useMemo(() => {
    if (selectedServiceDefinitions.length === 0) return teamEmployees;
    return teamEmployees.filter((employee) => selectedServiceDefinitions.every((service) => isEmployeeEligibleForService(employee, service)));
  }, [teamEmployees, selectedServiceDefinitions]);

  const selectedEmployeeIsEligible = useMemo(() => {
    if (selectedServiceDefinitions.length === 0) return true;
    return eligibleEmployees.some((employee) => employee.id === bookEmp);
  }, [selectedServiceDefinitions.length, eligibleEmployees, bookEmp]);

  const employeeSelectOptions = useMemo(() => {
    if (selectedServiceDefinitions.length === 0) return teamEmployees;
    if (eligibleEmployees.length === 0) return teamEmployees;
    if (selectedEmployeeIsEligible) return eligibleEmployees;

    const currentEmployee = teamEmployees.find((employee) => employee.id === bookEmp);
    if (!currentEmployee) return eligibleEmployees;

    return [{ ...currentEmployee, name: `${currentEmployee.name} (não apto)` }, ...eligibleEmployees];
  }, [selectedServiceDefinitions.length, teamEmployees, eligibleEmployees, selectedEmployeeIsEligible, bookEmp]);

  const employeeEligibilityHint = useMemo(() => {
    if (selectedServiceDefinitions.length === 0) {
      return 'Selecione um serviço para destacar profissionais compatíveis.';
    }

    if (eligibleEmployees.length === 0) {
      return 'Nenhum profissional atende aos requisitos dos serviços selecionados.';
    }

    if (!selectedEmployeeIsEligible) {
      return 'Profissional atual não atende aos serviços escolhidos. Escolha um dos sugeridos.';
    }

    return `${eligibleEmployees.length} profissional(is) compatível(is) com os serviços selecionados.`;
  }, [selectedServiceDefinitions.length, eligibleEmployees.length, selectedEmployeeIsEligible]);

  useEffect(() => {
    if (!isClientSearchOpen) {
      setActiveClientIndex(-1);
      return;
    }

    setActiveClientIndex(filteredClients.length > 0 ? 0 : -1);
  }, [filteredClients, isClientSearchOpen]);

  const selectClient = (client: Client) => {
    const parsed = parseClientObservation(client.observacao);
    // CPF só do próprio cadastro: buscar por nome no histórico misturava homônimos
    const finalCpf = client.cpf || '';

    setSelectedClientId(client.id);
    setBookName(client.nome);
    setBookPhone(formatPhone(client.telefone || ''));
    setBookCpf(formatCpf(finalCpf));
    setBookClientObservation(parsed.note);
    setAnamneseData(parsed.anamData);
    setClientSearchTerm(`${client.nome}${client.cpf ? ` - ${client.cpf}` : ''}`);
    setIsClientSearchOpen(false);
    setActiveClientIndex(-1);
  };

  const handleClientSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isClientSearchOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setIsClientSearchOpen(true);
      return;
    }

    if (filteredClients.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveClientIndex((prev) => (prev < 0 ? 0 : (prev + 1) % filteredClients.length));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveClientIndex((prev) => (prev <= 0 ? filteredClients.length - 1 : prev - 1));
      return;
    }

    if (e.key === 'Enter' && isClientSearchOpen && activeClientIndex >= 0) {
      e.preventDefault();
      selectClient(filteredClients[activeClientIndex]);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setIsClientSearchOpen(false);
    }
  };

  const switchClientMode = (mode: 'search' | 'new') => {
    setClientMode(mode);
    setConflictMessage(null);
    if (mode === 'new') {
      setSelectedClientId(null);
      setClientSearchTerm('');
      setIsClientSearchOpen(false);
      return;
    }

    const seededSearch = bookName.trim();
    if (!selectedClientId && seededSearch.length >= 2) {
      setClientSearchTerm(seededSearch);
      setIsClientSearchOpen(true);
    }
  };

  const handleQuickBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bookingBusy) return;
    setConflictMessage(null);
    if (clientMode === 'search' && !selectedClientId) {
      setErrorMessage('Selecione um cliente na busca para continuar.');
      return;
    }
    if (bookService.length === 0) {
      setErrorMessage('Por favor, selecione pelo menos um serviço.'); return;
    }

    if (!selectedEmployeeIsEligible) {
      setErrorMessage('O profissional selecionado não atende aos requisitos dos serviços escolhidos. Selecione um profissional compatível.');
      return;
    }

    const scheduleValidationError = validateAppointmentScheduling({
      date: bookDate,
      time: bookTime,
      employeeId: bookEmp,
      serviceNames: bookService,
      appointments,
      services,
    });

    if (scheduleValidationError) {
      setErrorMessage(scheduleValidationError);
      return;
    }

    const startMinutes = horarioParaMinutos(bookTime);
    const durationMinutes = getDuration(bookService, services);
    const closingMinutes = SCHEDULE_CONFIG.END_HOUR * 60;

    if (startMinutes + durationMinutes > closingMinutes) {
      setErrorMessage(`Este agendamento ultrapassa o fechamento às ${String(SCHEDULE_CONFIG.END_HOUR).padStart(2, '0')}:00. Reduza os serviços ou escolha um horário mais cedo.`);
      return;
    }

    const selectedEmployee = employees.find((emp) => emp.id === bookEmp);
    const overlapBlock = (selectedEmployee?.bloqueios || [])
      .filter((block) => block.data === bookDate)
      .find((block) => {
        const blockStart = horarioParaMinutos(block.horaInicio);
        const blockEnd = horarioParaMinutos(block.horaFim);
        return startMinutes < blockEnd && startMinutes + durationMinutes > blockStart;
      });

    if (overlapBlock) {
      setErrorMessage(`Profissional indisponível no período: ${overlapBlock.motivo}.`);
      return;
    }

    const finalDetails = showAnamnese ? `${bookDetails}${formatAnamnese(anamneseData)}`.trim() : bookDetails;
    const payloadObservation = formatAnamneseStorage(bookClientObservation, anamneseData);

    // Só reaproveita o cliente escolhido na busca; nomes iguais podem ser pessoas diferentes.
    // O backend atualiza os dados do cliente na mesma transação do agendamento (tudo ou nada).
    const selectedClient = clientMode === 'search'
      ? clients.find(c => c.id === selectedClientId)
      : undefined;

    setIsSubmitting(true);
    try {
      const success = await onAddAppointment({
        clientName: bookName, contact: bookPhone || 'Não informado', date: bookDate, time: bookTime, guests: 1, specialNeeds: [],
        observation: finalDetails,
        assignedEmployeeId: bookEmp,
        services: bookService,
        cpf: bookCpf,
        clientId: selectedClient?.id,
        clientObservation: payloadObservation,
      });

      if (success !== false) {
        clearDraft();
        onClose();
        setToastMessage('Agendamento salvo na sua agenda!');
      }
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setConflictMessage(error.message || 'Conflito de horário detectado. Atualize a agenda e tente outro intervalo.');
        return;
      }

      if (isApiError(error) && error.status === 400) {
        setErrorMessage(error.message);
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar o agendamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasUnsavedChanges = Boolean(
    bookName.trim() || bookPhone || bookCpf || bookService.length > 0 || bookDetails.trim()
    || bookClientObservation.trim() || selectedClientId || JSON.stringify(anamneseData) !== JSON.stringify(initialAnamnese),
  );

  // Fechar de propósito descarta o rascunho; ele só sobrevive a recarregar a página ou à sessão expirar
  const handleClose = () => {
    clearDraft();
    onClose();
  };

  return (
    <>
      <AppointmentModalShell
        title="Novo Agendamento"
        onClose={handleClose}
        hasUnsavedChanges={hasUnsavedChanges}
        onSubmit={handleQuickBook}
        submitLabel="Confirmar Agendamento"
        submitDisabled={bookingBusy}
        isSubmitting={bookingBusy}
        submittingLabel="Salvando..."
        showSubmitButton={canShowBookingDetails}
        alertBanner={conflictMessage ? (
          <div className="mb-4 rounded-2xl border border-error/30 bg-error/10 p-3 text-xs text-on-surface">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined text-[16px] text-error mt-0.5">event_busy</span>
              <div>
                <p className="font-bold text-error uppercase tracking-[0.12em] text-[10px]">Horário indisponível</p>
                <p className="text-on-surface-variant mt-1">{conflictMessage}</p>
                <p className="text-on-surface-variant mt-1">Dica: escolha outro horário ou atualize o colaborador para confirmar os slots livres.</p>
              </div>
            </div>
          </div>
        ) : undefined}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Modo do cliente</span>
          <div className="inline-flex rounded-xl bg-surface-container p-1 border border-outline-variant/20">
            <button
              type="button"
              onClick={() => switchClientMode('search')}
              className={`px-3 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-colors ${clientMode === 'search' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'}`}
            >
              Buscar Cliente
            </button>
            <button
              type="button"
              onClick={() => switchClientMode('new')}
              className={`px-3 py-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-colors ${clientMode === 'new' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'}`}
            >
              Novo Cliente
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {clientMode === 'search' && (
            <div ref={clientSearchWrapperRef}>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Buscar Cliente</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline-variant text-[18px]">search</span>
                <input
                  type="text"
                  value={clientSearchTerm}
                  onFocus={() => setIsClientSearchOpen(true)}
                  onKeyDown={handleClientSearchKeyDown}
                  onChange={e => {
                    setConflictMessage(null);
                    setClientSearchTerm(e.target.value);
                    setSelectedClientId(null);
                    setIsClientSearchOpen(true);
                  }}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl pl-10 p-3 pr-24 focus:ring-1 focus:ring-primary text-sm"
                  placeholder="Digite nome, telefone ou CPF"
                  autoComplete="off"
                />
                {clientSearchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientSearchTerm('');
                      setSelectedClientId(null);
                      setIsClientSearchOpen(false);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase font-bold tracking-widest text-on-surface-variant hover:text-primary"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-on-surface-variant">Digite pelo menos 2 caracteres para buscar.</p>
              {isClientSearchOpen && filteredClients.length > 0 && (
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-low custom-scrollbar shadow-sm">
                  {filteredClients.map((c, index) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectClient(c);
                      }}
                      className={`w-full text-left px-3 py-2 transition-colors border-b last:border-b-0 border-outline-variant/10 ${(selectedClientId === c.id || index === activeClientIndex) ? 'bg-primary/10' : 'hover:bg-primary/10'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-on-surface truncate">{c.nome}</p>
                        {selectedClientId === c.id && (
                          <span className="text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">Selecionado</span>
                        )}
                      </div>
                      <p className="text-[10px] text-on-surface-variant mt-0.5 truncate">
                        {c.telefone ? formatPhone(c.telefone) : 'Sem telefone'}{c.cpf ? ` · CPF ${formatCpf(c.cpf)}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {isClientSearchOpen && clientSearchTerm.trim().length >= 2 && filteredClients.length === 0 && (
                <div className="mt-2 rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
                  <p className="text-xs text-on-surface-variant">Nenhum cliente encontrado para essa busca.</p>
                </div>
              )}
            </div>
          )}
          {clientMode === 'new' ? (
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Nome do Cliente</label>
              <input
                required
                type="text"
                value={bookName}
                onChange={e => setBookName(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm"
                placeholder="Nome completo"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Cliente Selecionado</p>
                <p className="text-sm font-bold text-on-surface truncate">{bookName || 'Nenhum cliente selecionado'}</p>
              </div>
              {selectedClientId && <span className="text-[10px] text-primary font-bold uppercase tracking-widest">ok</span>}
            </div>
          )}
          {canShowBookingDetails && (
            <>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Telefone</label>
                <input type="text" value={bookPhone} onChange={e => setBookPhone(formatPhone(e.target.value))} maxLength={15} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm" placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">CPF</label>
                <input type="text" value={bookCpf} onChange={e => setBookCpf(formatCpf(e.target.value))} maxLength={14} className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm" placeholder="000.000.000-00" />
              </div>
            </>
          )}
        </div>
        {!canShowBookingDetails && clientMode === 'search' && (
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3">
            <p className="text-xs text-on-surface-variant">Selecione um cliente para liberar os demais campos de agendamento.</p>
          </div>
        )}
        {canShowBookingDetails && (
          <AppointmentScheduleFields
            date={bookDate}
            time={bookTime}
            employeeId={bookEmp}
            selectedServices={bookService}
            details={bookDetails}
            employees={employeeSelectOptions}
            services={filteredServices}
            employeeHelperText={employeeEligibilityHint}
            onDateChange={(value) => {
              setConflictMessage(null);
              setBookDate(value);
            }}
            onTimeChange={(value) => {
              setConflictMessage(null);
              setBookTime(value);
            }}
            onEmployeeChange={(value) => {
              setConflictMessage(null);
              setBookEmp(value);
            }}
            onToggleService={(serviceName) => {
              setConflictMessage(null);
              setBookService(prev => prev.includes(serviceName) ? prev.filter(item => item !== serviceName) : [...prev, serviceName]);
            }}
            onDetailsChange={setBookDetails}
            showServiceSearch={true}
            serviceSearchTerm={serviceSearchTerm}
            onServiceSearchTermChange={setServiceSearchTerm}
            detailsLabel="Observações"
            detailsPlaceholder="Ex: Preferências do cliente..."
            detailsAction={(
              <button type="button" onClick={() => setShowAnamnese(true)} className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high">
                + Ficha de Anamnese
              </button>
            )}
          />
        )}
      </AppointmentModalShell>
      {showAnamnese && <AnamneseForm data={anamneseData} onChange={setAnamneseData} onClose={() => setShowAnamnese(false)} />}
    </>
  );
}