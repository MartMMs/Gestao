import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Employee, TurnoSwapRequest, TurnoSwapStatus, EmployeeUpdate } from '../../../types';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { aplicarAjusteEscala, gerarEscalaComRegras, type DiaEscala } from '../../../utils/escalaCalculator';
import { categoriaDoDia, turnoDoDia } from '../utils/turnos';
import { analisarConformidadeCLT } from '../../../utils/cltValidator';
import { isTeamMember } from '../../../utils/formatters';
import type { ScaleOverridePayload } from '../../../api';

// Estado e regras da aba "Grade de Escalas" do supervisor (planejamento mensal/semanal, gerador e alertas CLT)

// Definição única em api.ts (re-exportada para quem já importava daqui)
export type { ScaleOverridePayload };

export type PlanningDateScope = 'mensal' | 'semanal';
export type PlanningShiftFilter = 'all' | 'manha' | 'tarde' | 'noite' | 'comercial' | 'folga';
export type PlanningWorkloadFilter = 'all' | 'ate36' | '37a44' | '45plus';

const isValidScaleDayType = (value: unknown): value is DiaEscala['tipo'] => (
  value === 'trabalho' || value === 'folga' || value === 'fds'
);

// Ajuste vindo do servidor no formato da grade (tipo desconhecido é ignorado; turno só em dia de trabalho)
const normalizarAjuste = (override: ScaleOverridePayload): ScaleOverridePayload | null => {
  if (!override?.colaboradorId || !override?.data || !isValidScaleDayType(override.tipo)) return null;
  return {
    colaboradorId: override.colaboradorId,
    data: override.data,
    tipo: override.tipo,
    turno: override.tipo === 'trabalho' ? override.turno || undefined : undefined,
    descricao: override.descricao || undefined,
  };
};
const dataBR = (data: string) => data.split('-').reverse().join('/');

type UsePlanejamentoEscalaParams = {
  employees: Employee[];
  scaleOverrides: ScaleOverridePayload[];
  turnoSwapRequests: TurnoSwapRequest[];
  onEditEmployee: (id: string, employee: EmployeeUpdate) => Promise<boolean | string | void> | void;
  onUpdateTurnoSwapRequestStatus?: (id: string, status: Exclude<TurnoSwapStatus, 'pendente'>, respostaObservacao?: string) => Promise<boolean | void> | void;
  onSaveScaleOverride?: (payload: ScaleOverridePayload) => Promise<boolean | void> | void;
  setToastMessage: (mensagem: string | null) => void;
  setErrorMessage: (mensagem: string | null) => void;
};

export function usePlanejamentoEscala({
  employees, scaleOverrides, turnoSwapRequests, onEditEmployee, onUpdateTurnoSwapRequestStatus, onSaveScaleOverride, setToastMessage, setErrorMessage,
}: UsePlanejamentoEscalaParams) {
  const todayStr = getLocalTodayString();
  const [selectedScaleEmployeeId, setSelectedScaleEmployeeId] = useState('');
  const [selectedScaleMonth, setSelectedScaleMonth] = useState(getLocalTodayString().slice(0, 7));
  const [selectedPlanningEmployeeId, setSelectedPlanningEmployeeId] = useState<string | null>(null);
  const [planningScaleType, setPlanningScaleType] = useState<Employee['tipoEscala']>('6x1');
  const [planningSundayOffs, setPlanningSundayOffs] = useState(2);
  const [planningCoverageTarget, setPlanningCoverageTarget] = useState(5);
  const [planningSundayFrequency, setPlanningSundayFrequency] = useState<'1x1' | '2x1'>('2x1');
  const [isSavingPlanning, setIsSavingPlanning] = useState(false);
  const [showTopAlerts, setShowTopAlerts] = useState(true);
  const [dismissedCltAlertIds, setDismissedCltAlertIds] = useState<Record<string, boolean>>({});
  const cltAlertTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [planningViewMode, setPlanningViewMode] = useState<'calendario' | 'timeline'>(() => {
    if (typeof window === 'undefined') return 'calendario';
    const saved = window.sessionStorage.getItem('supervisor-planning-view-mode');
    return saved === 'timeline' ? 'timeline' : 'calendario';
  });
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isPlanningEditMode, setIsPlanningEditMode] = useState(false);
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'folgaHoje'>('all');
  const [planningDateScope, setPlanningDateScope] = useState<PlanningDateScope>('mensal');
  const [planningWeekIndex, setPlanningWeekIndex] = useState(1);
  const [planningEmployeeFilter, setPlanningEmployeeFilter] = useState<string>('all');
  const [planningShiftFilter, setPlanningShiftFilter] = useState<PlanningShiftFilter>('all');
  const [planningWorkloadFilter, setPlanningWorkloadFilter] = useState<PlanningWorkloadFilter>('all');
  const [isScaleGeneratorOpen, setIsScaleGeneratorOpen] = useState(false);
  const [scaleGeneratorEmployeeId, setScaleGeneratorEmployeeId] = useState('');
  const [scaleGeneratorMonth, setScaleGeneratorMonth] = useState(getLocalTodayString().slice(0, 7));
  const [scaleGeneratorType, setScaleGeneratorType] = useState<Employee['tipoEscala']>('6x1');
  const [scaleGeneratorSundayOffs, setScaleGeneratorSundayOffs] = useState(2);
  const [scaleGeneratorCoverageTarget, setScaleGeneratorCoverageTarget] = useState(5);
  const [scaleGeneratorSundayFrequency, setScaleGeneratorSundayFrequency] = useState<'1x1' | '2x1'>('2x1');
  const [scaleGeneratorSearch, setScaleGeneratorSearch] = useState('');
  const planningMonthInputRef = useRef<HTMLInputElement | null>(null);
  const [planningOverrides, setPlanningOverrides] = useState<Record<string, ScaleOverridePayload>>({});
  const [suggestedPlanningKeys, setSuggestedPlanningKeys] = useState<string[]>([]);
  // Recarga do servidor (socket, outra gravação) não pode apagar uma proposta que ainda espera "Confirmar Escala"
  const suggestedKeysRef = useRef(new Set<string>());
  // Antes do efeito de mescla abaixo (efeitos rodam na ordem): ele lê a ref já atualizada
  useEffect(() => {
    suggestedKeysRef.current = new Set(suggestedPlanningKeys);
  }, [suggestedPlanningKeys]);
  // O que está gravado no servidor, por "colaborador:data" (proposta pendente não entra)
  const ajustesSalvos = useMemo(() => {
    const mapa = new Map<string, ScaleOverridePayload>();
    scaleOverrides.forEach((override) => {
      const ajuste = normalizarAjuste(override);
      if (ajuste) mapa.set(`${ajuste.colaboradorId}:${ajuste.data}`, ajuste);
    });
    return mapa;
  }, [scaleOverrides]);
  const planningOverridesList = useMemo(
    () => Object.values(planningOverrides) as ScaleOverridePayload[],
    [planningOverrides],
  );


  useEffect(() => {
    setPlanningOverrides((prev) => {
      const next = { ...prev };
      ajustesSalvos.forEach((ajuste, chave) => {
        if (!suggestedKeysRef.current.has(chave)) next[chave] = ajuste;
      });
      return next;
    });
  }, [ajustesSalvos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('supervisor-planning-view-mode', planningViewMode);
  }, [planningViewMode]);

  const activeNonAdminEmployees = useMemo(
    () => employees.filter((emp) => isTeamMember(emp)),
    [employees],
  );

  const effectiveSelectedScaleEmployeeId = useMemo(
    () => selectedScaleEmployeeId || activeNonAdminEmployees[0]?.id || '',
    [selectedScaleEmployeeId, activeNonAdminEmployees],
  );

  const selectedScaleEmployee = useMemo(
    () => activeNonAdminEmployees.find((emp) => emp.id === effectiveSelectedScaleEmployeeId) || null,
    [activeNonAdminEmployees, effectiveSelectedScaleEmployeeId],
  );

  useEffect(() => {
    if (!selectedScaleEmployee) return;
    setPlanningScaleType(selectedScaleEmployee.tipoEscala || '6x1');
    setPlanningSundayOffs(selectedScaleEmployee.folgasDomingoNoMes ?? 2);
  }, [selectedScaleEmployee]);

  const applyOverrideToDia = useCallback(
    (employeeId: string, dia: DiaEscala): DiaEscala => aplicarAjusteEscala(dia, planningOverrides[`${employeeId}:${dia.data}`]),
    [planningOverrides],
  );

  const employeeById = useMemo(
    () => new Map(activeNonAdminEmployees.map((emp) => [emp.id, emp])),
    [activeNonAdminEmployees],
  );

  const buildScaleForEmployee = useCallback((employeeId: string, options?: {
    tipoEscala?: Employee['tipoEscala'];
    folgasDomingoNoMes?: number;
    mes?: string; // AAAA-MM; padrão: o mês aberto na grade
  }) => {
    const employee = employeeById.get(employeeId);
    if (!employee) return [] as DiaEscala[];

    const [yearRaw, monthRaw] = (options?.mes || selectedScaleMonth).split('-').map(Number);
    const year = yearRaw || new Date().getFullYear();
    const month = monthRaw || new Date().getMonth() + 1;
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(year, month, 0).getDate();

    const diasComRegras = gerarEscalaComRegras(
      {
        tipo: options?.tipoEscala || employee.tipoEscala || '6x1',
        dataInicio: firstDay,
      },
      daysInMonth,
      { folgasDomingoNoMes: options?.folgasDomingoNoMes ?? employee.folgasDomingoNoMes ?? 2 },
    );

    return diasComRegras.map((dia) => applyOverrideToDia(employeeId, dia));
  }, [employeeById, applyOverrideToDia, selectedScaleMonth]);

  const selectedScaleCalendar = useMemo(() => {
    if (!selectedScaleEmployee) {
      return { year: 0, month: 0, dias: [] as DiaEscala[] };
    }

    const [yearRaw, monthRaw] = selectedScaleMonth.split('-').map(Number);
    const year = yearRaw || new Date().getFullYear();
    const month = monthRaw || new Date().getMonth() + 1;

    return {
      year,
      month,
      dias: buildScaleForEmployee(selectedScaleEmployee.id, {
        tipoEscala: planningScaleType || selectedScaleEmployee.tipoEscala || '6x1',
        folgasDomingoNoMes: planningSundayOffs,
      }),
    };
  }, [buildScaleForEmployee, planningScaleType, planningSundayOffs, selectedScaleEmployee, selectedScaleMonth]);

  const selectedScaleMonthLabel = useMemo(() => {
    const [yearRaw, monthRaw] = selectedScaleMonth.split('-').map(Number);
    const safeYear = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
    const safeMonth = Number.isFinite(monthRaw) ? monthRaw : new Date().getMonth() + 1;
    const label = new Date(safeYear, Math.max(0, safeMonth - 1), 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [selectedScaleMonth]);

  const changeScaleMonthBy = useCallback((offset: number) => {
    setSelectedScaleMonth((current) => {
      const [yearRaw, monthRaw] = current.split('-').map(Number);
      const safeYear = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
      const safeMonth = Number.isFinite(monthRaw) ? monthRaw : new Date().getMonth() + 1;
      const next = new Date(safeYear, safeMonth - 1 + offset, 1);
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  const openPlanningMonthPicker = useCallback(() => {
    const input = planningMonthInputRef.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === 'function') {
      pickerInput.showPicker();
      return;
    }

    input.click();
  }, []);

  const selectedScaleMonthMeta = useMemo(() => {
    const [yearRaw, monthRaw] = selectedScaleMonth.split('-').map(Number);
    const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
    const month = Number.isFinite(monthRaw) ? monthRaw : new Date().getMonth() + 1;
    const days = new Date(year, month, 0).getDate();
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    return { year, month, days, firstWeekday };
  }, [selectedScaleMonth]);

  const selectedScaleMonthDayCount = selectedScaleMonthMeta.days;

  const planningWeekRanges = useMemo(() => {
    const ranges: Array<{ start: number; end: number }> = [];
    const { days, firstWeekday } = selectedScaleMonthMeta;

    if (days <= 0) return [{ start: 1, end: 1 }];

    const firstWeekLength = Math.max(1, 7 - firstWeekday);
    const firstEnd = Math.min(days, firstWeekLength);
    ranges.push({ start: 1, end: firstEnd });

    let cursor = firstEnd + 1;
    while (cursor <= days) {
      const end = Math.min(days, cursor + 6);
      ranges.push({ start: cursor, end });
      cursor = end + 1;
    }

    return ranges;
  }, [selectedScaleMonthMeta]);

  const planningWeekOptions = useMemo(() => {
    return planningWeekRanges.map((_, index) => index + 1);
  }, [planningWeekRanges]);

  useEffect(() => {
    setPlanningWeekIndex((current) => {
      if (current <= planningWeekOptions.length) return current;
      return planningWeekOptions.length;
    });
  }, [planningWeekOptions]);

  const planningVisibleDayRange = useMemo(() => {
    if (planningDateScope === 'mensal') {
      return {
        start: 1,
        end: selectedScaleMonthDayCount,
      };
    }

    const selectedWeekRange = planningWeekRanges[Math.max(0, planningWeekIndex - 1)] || planningWeekRanges[0];
    return selectedWeekRange;
  }, [planningDateScope, planningWeekIndex, planningWeekRanges, selectedScaleMonthDayCount]);

  useEffect(() => {
    if (planningEmployeeFilter === 'all') return;
    setSelectedScaleEmployeeId(planningEmployeeFilter);
  }, [planningEmployeeFilter]);

  // Filtro por período do dia: a mesma regra do calendário e da linha do tempo
  const classifyShift = useCallback((dia: DiaEscala) => (dia.tipo === 'trabalho' ? categoriaDoDia(dia) : null), []);

  const scaleByEmployee = useMemo(() => {
    const map = new Map<string, DiaEscala[]>();
    activeNonAdminEmployees.forEach((employee) => {
      map.set(employee.id, buildScaleForEmployee(employee.id));
    });
    return map;
  }, [activeNonAdminEmployees, buildScaleForEmployee]);

  const timelineEmployees = useMemo(() => {
    const search = employeeSearchTerm.trim().toLowerCase();

    const isDayInsideRange = (dia: DiaEscala) => {
      const dayValue = Number(dia.data.split('-')[2]);
      if (!Number.isFinite(dayValue)) return false;
      return dayValue >= planningVisibleDayRange.start && dayValue <= planningVisibleDayRange.end;
    };

    const workloadMatches = (employee: Employee) => {
      const carga = Number(employee.cargaHorariaSemanal) || 40;
      if (planningWorkloadFilter === 'all') return true;
      if (planningWorkloadFilter === 'ate36') return carga <= 36;
      if (planningWorkloadFilter === '37a44') return carga >= 37 && carga <= 44;
      return carga >= 45;
    };

    return activeNonAdminEmployees.filter((emp) => {
      const employeeScale = scaleByEmployee.get(emp.id) || [];
      const visibleScale = employeeScale.filter(isDayInsideRange);

      if (filterRole !== 'all' && emp.cargo !== filterRole) return false;
      if (planningEmployeeFilter !== 'all' && emp.id !== planningEmployeeFilter) return false;
      if (!workloadMatches(emp)) return false;

      if (filterStatus === 'folgaHoje') {
        const diaHoje = employeeScale.find((dia) => dia.data === todayStr);
        if (diaHoje?.tipo !== 'folga') return false;
      }

      if (planningShiftFilter !== 'all') {
        const hasShiftMatch = planningShiftFilter === 'folga'
          ? visibleScale.some((dia) => dia.tipo !== 'trabalho')
          : visibleScale.some((dia) => classifyShift(dia) === planningShiftFilter);

        if (!hasShiftMatch) return false;
      }

      if (search) {
        const composite = `${emp.name} ${emp.cargo || ''} ${emp.specialty || ''}`.toLowerCase();
        if (!composite.includes(search)) return false;
      }

      return true;
    });
  }, [
    activeNonAdminEmployees,
    classifyShift,
    employeeSearchTerm,
    filterRole,
    filterStatus,
    planningEmployeeFilter,
    planningShiftFilter,
    planningVisibleDayRange,
    planningWorkloadFilter,
    scaleByEmployee,
    todayStr,
  ]);

  const filteredScaleGeneratorEmployees = useMemo(() => {
    const search = scaleGeneratorSearch.trim().toLowerCase();
    if (!search) return activeNonAdminEmployees;
    return activeNonAdminEmployees.filter((emp) => {
      const composite = `${emp.name} ${emp.cargo || ''} ${emp.specialty || ''}`.toLowerCase();
      return composite.includes(search);
    });
  }, [activeNonAdminEmployees, scaleGeneratorSearch]);

  const handleOpenScaleGenerator = () => {
    const baseEmployee = activeNonAdminEmployees.find((emp) => emp.id === effectiveSelectedScaleEmployeeId)
      || activeNonAdminEmployees[0]
      || null;

    if (!baseEmployee) {
      setErrorMessage('Nenhum colaborador disponível para gerar escala.');
      return;
    }

    setScaleGeneratorEmployeeId(baseEmployee.id);
    setScaleGeneratorMonth(selectedScaleMonth);
    setScaleGeneratorType(baseEmployee.tipoEscala || '6x1');
    setScaleGeneratorSundayOffs(baseEmployee.folgasDomingoNoMes ?? 2);
    setScaleGeneratorCoverageTarget(planningCoverageTarget);
    setScaleGeneratorSundayFrequency(planningSundayFrequency);
    setScaleGeneratorSearch('');
    setIsScaleGeneratorOpen(true);
  };

  useEffect(() => {
    if (!isScaleGeneratorOpen) return;
    const employee = activeNonAdminEmployees.find((emp) => emp.id === scaleGeneratorEmployeeId);
    if (!employee) return;
    setScaleGeneratorType(employee.tipoEscala || '6x1');
    setScaleGeneratorSundayOffs(employee.folgasDomingoNoMes ?? 2);
  }, [activeNonAdminEmployees, isScaleGeneratorOpen, scaleGeneratorEmployeeId]);

  const handleGenerateScale = async () => {
    if (!scaleGeneratorEmployeeId || !scaleGeneratorMonth || isSavingPlanning) return;

    setIsSavingPlanning(true);
    try {
      const success = await onEditEmployee(scaleGeneratorEmployeeId, {
        tipoEscala: scaleGeneratorType,
        folgasDomingoNoMes: scaleGeneratorSundayOffs,
      });

      if (typeof success === 'string') {
        setErrorMessage(success);
        return;
      }

      if (success !== false) {
        setSelectedScaleEmployeeId(scaleGeneratorEmployeeId);
        setSelectedScaleMonth(scaleGeneratorMonth);
        setPlanningScaleType(scaleGeneratorType);
        setPlanningSundayOffs(scaleGeneratorSundayOffs);
        setPlanningCoverageTarget(scaleGeneratorCoverageTarget);
        setPlanningSundayFrequency(scaleGeneratorSundayFrequency);
        setIsScaleGeneratorOpen(false);

        setToastMessage('Escala gerada com sucesso.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível gerar a escala.');
    } finally {
      setIsSavingPlanning(false);
    }
  };

  const handleTogglePlanningEditMode = () => {
    if (!isPlanningEditMode) {
      setIsPlanningEditMode(true);
      setToastMessage('Modo de troca de dias ativado.');
      return;
    }

    // Cada troca já foi gravada na hora: aqui só sai do modo de edição
    setIsPlanningEditMode(false);
    setToastMessage('Modo de edição encerrado.');
  };

  const applyManualPlanningOverride = useCallback((payload: ScaleOverridePayload, successMessage: string) => {
    const key = `${payload.colaboradorId}:${payload.data}`;
    let previousOverride: ScaleOverridePayload | undefined;

    setPlanningOverrides((prev) => {
      previousOverride = prev[key];
      return {
        ...prev,
        [key]: payload,
      };
    });

    setSuggestedPlanningKeys((prev) => prev.filter((item) => item !== key));

    void (async () => {
      const revertOverride = () => {
        setPlanningOverrides((prev) => {
          const next = { ...prev };
          if (previousOverride) next[key] = previousOverride;
          else delete next[key];
          return next;
        });
      };

      try {
        if (onSaveScaleOverride) {
          const success = await onSaveScaleOverride(payload);
          if (success === false) {
            revertOverride();
            setErrorMessage('Não foi possível sincronizar a alteração da escala com o servidor.');
            return;
          }
        }

        setToastMessage(successMessage);
      } catch (error) {
        revertOverride();
        setErrorMessage(error instanceof Error ? error.message : 'Falha na sincronização da escala com o servidor.');
      }
    })();
  }, [onSaveScaleOverride, setErrorMessage, setToastMessage]);

  const handleQuickToggleTimelineDay = useCallback((employeeId: string, day: string, current?: DiaEscala) => {
    const nextType: DiaEscala['tipo'] = current?.tipo === 'trabalho' ? 'folga' : 'trabalho';
    const payload: ScaleOverridePayload = {
      colaboradorId: employeeId,
      data: day,
      tipo: nextType,
      turno: nextType === 'trabalho' ? turnoDoDia(current) : undefined, // sem turno legível, fica sem turno
      descricao: nextType === 'trabalho' ? 'Ajuste manual rápido' : 'Folga manual rápida',
    };

    applyManualPlanningOverride(payload, `Dia atualizado para ${nextType === 'trabalho' ? 'trabalho' : 'folga'}.`);
  }, [applyManualPlanningOverride]);

  const handleQuickSetTimelineDay = useCallback((employeeId: string, day: string, tipo: DiaEscala['tipo'], turno?: string) => {
    const payload: ScaleOverridePayload = {
      colaboradorId: employeeId,
      data: day,
      tipo,
      turno: tipo === 'trabalho' ? turno || undefined : undefined,
      descricao: tipo === 'folga' ? 'Folga manual' : turno ? `Turno manual (${turno})` : 'Trabalho manual',
    };

    applyManualPlanningOverride(payload, 'Turno ajustado manualmente.');
  }, [applyManualPlanningOverride]);

  const handleSuggestAutomaticScale = useCallback(() => {
    if (timelineEmployees.length === 0) {
      setErrorMessage('Nenhum colaborador disponível para sugerir escala.');
      return;
    }

    const [yearRaw, monthRaw] = selectedScaleMonth.split('-').map(Number);
    const year = yearRaw || new Date().getFullYear();
    const month = monthRaw || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const sundayPatternLength = planningSundayFrequency === '1x1' ? 2 : 3;
    // shortcut: a sugestão automática gira os 3 turnos de 24h (manhã/tarde/noite) fixos, não os turnos padrão cadastrados;
    // usar useTurnos aqui quando a empresa precisar de sugestão com turnos próprios
    const shiftRotation = ['06:00-14:00', '14:00-22:00', '22:00-06:00'];

    const nextSuggested: Record<string, ScaleOverridePayload> = {};
    const suggestedKeys: string[] = [];

    const getProjectedDia = (employeeId: string, date: string) => {
      const key = `${employeeId}:${date}`;
      if (nextSuggested[key]) {
        return {
          tipo: nextSuggested[key].tipo,
          turno: nextSuggested[key].turno,
          descricao: nextSuggested[key].descricao,
        } as DiaEscala;
      }

      return buildScaleForEmployee(employeeId).find((dia) => dia.data === date);
    };

    timelineEmployees.forEach((employee, employeeIndex) => {
      const employeeScale = buildScaleForEmployee(employee.id);
      const sundays = employeeScale.filter((dia) => new Date(`${dia.data}T12:00:00`).getDay() === 0);

      sundays.forEach((dia, sundayIndex) => {
        const shouldRestOnSunday = ((sundayIndex + employeeIndex) % sundayPatternLength) === (sundayPatternLength - 1);
        if (!shouldRestOnSunday) return;

        const key = `${employee.id}:${dia.data}`;
        nextSuggested[key] = {
          colaboradorId: employee.id,
          data: dia.data,
          tipo: 'folga',
          turno: undefined,
          descricao: 'Sugestão automática (regra de domingo)',
        };

        suggestedKeys.push(key);
      });
    });

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${selectedScaleMonth}-${String(day).padStart(2, '0')}`;
      let activeCount = timelineEmployees.reduce((acc, employee) => {
        const projectedDia = getProjectedDia(employee.id, date);
        return acc + ((projectedDia?.tipo || 'trabalho') === 'trabalho' ? 1 : 0);
      }, 0);

      if (activeCount >= planningCoverageTarget) continue;

      const standbyEmployees = timelineEmployees.filter((employee) => {
        const projectedDia = getProjectedDia(employee.id, date);
        return (projectedDia?.tipo || 'trabalho') !== 'trabalho';
      });

      for (let idx = 0; idx < standbyEmployees.length && activeCount < planningCoverageTarget; idx += 1) {
        const employee = standbyEmployees[idx];
        const key = `${employee.id}:${date}`;

        nextSuggested[key] = {
          colaboradorId: employee.id,
          data: date,
          tipo: 'trabalho',
          turno: shiftRotation[(day + idx) % shiftRotation.length],
          descricao: 'Sugestão automática (meta de cobertura)',
        };

        if (!suggestedKeys.includes(key)) suggestedKeys.push(key);
        activeCount += 1;
      }
    }

    setPlanningOverrides((prev) => {
      const next = { ...prev };
      suggestedPlanningKeys.forEach((key) => {
        delete next[key];
      });

      Object.entries(nextSuggested).forEach(([key, override]) => {
        next[key] = override;
      });

      return next;
    });

    setSuggestedPlanningKeys(suggestedKeys);
    setToastMessage(`Sugestão aplicada em ${suggestedKeys.length} dia(s).`);
  }, [buildScaleForEmployee, planningCoverageTarget, planningSundayFrequency, selectedScaleMonth, suggestedPlanningKeys, timelineEmployees]);

  // Modelos (repetir mês, 12x36): entram como proposta, como a sugestão automática; só gravam em "Confirmar Escala"
  const proporAjustes = useCallback((ajustes: ScaleOverridePayload[]) => {
    const chaves = ajustes.map((ajuste) => `${ajuste.colaboradorId}:${ajuste.data}`);
    setPlanningOverrides((prev) => {
      const next = { ...prev };
      ajustes.forEach((ajuste, indice) => { next[chaves[indice]] = ajuste; });
      return next;
    });
    setSuggestedPlanningKeys((prev) => [...new Set([...prev, ...chaves])]);
  }, []);

  // Desfaz a proposta na tela: volta o que está salvo no servidor
  const handleDiscardSuggestedScale = useCallback(() => {
    setPlanningOverrides((prev) => {
      const next = { ...prev };
      suggestedPlanningKeys.forEach((chave) => {
        const salvo = ajustesSalvos.get(chave);
        if (salvo) next[chave] = salvo;
        else delete next[chave];
      });
      return next;
    });
    setSuggestedPlanningKeys([]);
    setToastMessage('Proposta descartada.');
  }, [ajustesSalvos, setToastMessage, suggestedPlanningKeys]);

  const handleConfirmSuggestedScale = useCallback(async () => {
    if (suggestedPlanningKeys.length === 0 || isSavingPlanning) return;

    if (!onSaveScaleOverride) {
      setSuggestedPlanningKeys([]);
      setToastMessage('Escala confirmada localmente.');
      return;
    }

    setIsSavingPlanning(true);
    try {
      let successCount = 0;
      const failedKeys: string[] = [];
      const motivos: string[] = [];

      for (const key of suggestedPlanningKeys) {
        const override = planningOverrides[key];
        if (!override) continue;

        try {
          const success = await onSaveScaleOverride(override);
          if (success === false) throw new Error('o servidor não confirmou a gravação.');
          successCount += 1;
        } catch (error) {
          failedKeys.push(key);
          motivos.push(`${dataBR(override.data)}: ${error instanceof Error ? error.message : 'falha ao salvar.'}`);
        }
      }

      setSuggestedPlanningKeys(failedKeys);

      if (failedKeys.length === 0) {
        setToastMessage(`Escala confirmada (${successCount} ajuste(s) sincronizados).`);
      } else {
        // Os dias que falharam continuam como proposta (tracejados na grade) até corrigir ou descartar
        setErrorMessage(`${successCount} ajuste(s) gravado(s); ${failedKeys.length} não: ${motivos.slice(0, 3).join(' ')}${motivos.length > 3 ? ` (e mais ${motivos.length - 3})` : ''} Corrija e confirme de novo, ou descarte a proposta.`);
      }
    } finally {
      setIsSavingPlanning(false);
    }
  }, [isSavingPlanning, onSaveScaleOverride, planningOverrides, setErrorMessage, setToastMessage, suggestedPlanningKeys]);

  const cltRealtimeAlerts = useMemo(() => {
    return activeNonAdminEmployees
      .map((emp) => {
        const malha = buildScaleForEmployee(emp.id);
        const analise = analisarConformidadeCLT(malha, { tipoEscala: emp.tipoEscala || '6x1' });

        return {
          id: emp.id,
          nome: emp.name,
          conforme: analise.statusGeral,
          resumo: analise.resumo,
        };
      })
      .filter((item) => !item.conforme);
  }, [activeNonAdminEmployees, buildScaleForEmployee]);

  const pendingTurnoSwapRequests = useMemo(
    () => turnoSwapRequests.filter((request) => request.status === 'pendente'),
    [turnoSwapRequests],
  );

  const visibleCltToastAlerts = useMemo(
    () => cltRealtimeAlerts.filter((alerta) => !dismissedCltAlertIds[alerta.id]),
    [cltRealtimeAlerts, dismissedCltAlertIds],
  );

  useEffect(() => {
    const activeIds = new Set(cltRealtimeAlerts.map((alerta) => alerta.id));

    setDismissedCltAlertIds((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};

      Object.keys(prev).forEach((id) => {
        if (activeIds.has(id)) {
          next[id] = prev[id];
        } else {
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    Object.keys(cltAlertTimersRef.current).forEach((id) => {
      if (!activeIds.has(id)) {
        clearTimeout(cltAlertTimersRef.current[id]);
        delete cltAlertTimersRef.current[id];
      }
    });
  }, [cltRealtimeAlerts]);

  useEffect(() => {
    visibleCltToastAlerts.forEach((alerta) => {
      if (cltAlertTimersRef.current[alerta.id]) return;

      cltAlertTimersRef.current[alerta.id] = setTimeout(() => {
        setDismissedCltAlertIds((prev) => ({ ...prev, [alerta.id]: true }));
        const timer = cltAlertTimersRef.current[alerta.id];
        if (timer) {
          clearTimeout(timer);
          delete cltAlertTimersRef.current[alerta.id];
        }
      }, 8000);
    });
  }, [visibleCltToastAlerts]);

  useEffect(() => {
    return () => {
      Object.keys(cltAlertTimersRef.current).forEach((id) => {
        clearTimeout(cltAlertTimersRef.current[id]);
      });
      cltAlertTimersRef.current = {};
    };
  }, []);

  const [updatingSwapId, setUpdatingSwapId] = useState<string | null>(null);

  const handleUpdateSwapStatus = async (id: string, status: Exclude<TurnoSwapStatus, 'pendente'>) => {
    if (!onUpdateTurnoSwapRequestStatus || updatingSwapId === id) return;
    setUpdatingSwapId(id);

    try {
      const success = await onUpdateTurnoSwapRequestStatus(id, status);
      if (success !== false) {
        setToastMessage(`Solicitacao ${status === 'aprovada' ? 'aprovada' : 'rejeitada'} com sucesso.`);
      } else {
        setErrorMessage('Não foi possível atualizar a solicitação de troca.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível atualizar a solicitação de troca.');
    } finally {
      setUpdatingSwapId(null);
    }
  };


  return {
    scaleByEmployee,
    activeNonAdminEmployees,
    todayStr,
    setSelectedScaleEmployeeId,
    selectedScaleMonth,
    setSelectedScaleMonth,
    selectedPlanningEmployeeId,
    setSelectedPlanningEmployeeId,
    planningCoverageTarget,
    isSavingPlanning,
    showTopAlerts,
    setShowTopAlerts,
    setDismissedCltAlertIds,
    planningViewMode,
    setPlanningViewMode,
    isPopoverOpen,
    setIsPopoverOpen,
    isPlanningEditMode,
    employeeSearchTerm,
    setEmployeeSearchTerm,
    filterRole,
    setFilterRole,
    filterStatus,
    setFilterStatus,
    planningDateScope,
    setPlanningDateScope,
    planningWeekIndex,
    setPlanningWeekIndex,
    planningEmployeeFilter,
    setPlanningEmployeeFilter,
    planningShiftFilter,
    setPlanningShiftFilter,
    planningWorkloadFilter,
    setPlanningWorkloadFilter,
    isScaleGeneratorOpen,
    setIsScaleGeneratorOpen,
    scaleGeneratorEmployeeId,
    setScaleGeneratorEmployeeId,
    scaleGeneratorMonth,
    setScaleGeneratorMonth,
    scaleGeneratorType,
    setScaleGeneratorType,
    scaleGeneratorSundayOffs,
    setScaleGeneratorSundayOffs,
    scaleGeneratorCoverageTarget,
    setScaleGeneratorCoverageTarget,
    scaleGeneratorSundayFrequency,
    setScaleGeneratorSundayFrequency,
    scaleGeneratorSearch,
    setScaleGeneratorSearch,
    planningMonthInputRef,
    setPlanningOverrides,
    suggestedPlanningKeys,
    planningOverridesList,
    selectedScaleEmployee,
    buildScaleForEmployee,
    selectedScaleCalendar,
    selectedScaleMonthLabel,
    changeScaleMonthBy,
    openPlanningMonthPicker,
    planningWeekOptions,
    planningVisibleDayRange,
    timelineEmployees,
    filteredScaleGeneratorEmployees,
    handleOpenScaleGenerator,
    handleGenerateScale,
    handleTogglePlanningEditMode,
    handleQuickToggleTimelineDay,
    handleQuickSetTimelineDay,
    handleSuggestAutomaticScale,
    handleConfirmSuggestedScale,
    handleDiscardSuggestedScale,
    proporAjustes,
    setSuggestedPlanningKeys,
    ajustesSalvos,
    planningScaleType,
    planningSundayOffs,
    cltRealtimeAlerts,
    pendingTurnoSwapRequests,
    visibleCltToastAlerts,
    handleUpdateSwapStatus,
    updatingSwapId,
    setErrorMessage,
  };
}
