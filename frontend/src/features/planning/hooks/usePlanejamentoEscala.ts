import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Employee, TurnoSwapRequest, TurnoSwapStatus, EmployeeUpdate } from '../../../types';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { aplicarAjusteEscala, gerarEscalaComRegras, horaInicialDoTurno, separarTurno, type DiaEscala } from '../../../utils/escalaCalculator';
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
  const [selectedPlanningDay, setSelectedPlanningDay] = useState<DiaEscala | null>(null);
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
  const planningOverridesList = useMemo(
    () => Object.values(planningOverrides) as ScaleOverridePayload[],
    [planningOverrides],
  );


  useEffect(() => {
    setPlanningOverrides((prev) => {
      const next = { ...prev };
      scaleOverrides.forEach((override) => {
        if (!override?.colaboradorId || !override?.data) return;

        const tipo = isValidScaleDayType(override.tipo) ? override.tipo : null;
        if (!tipo) return;

        next[`${override.colaboradorId}:${override.data}`] = {
          colaboradorId: override.colaboradorId,
          data: override.data,
          tipo,
          turno: tipo === 'trabalho' ? override.turno : undefined,
          descricao: override.descricao,
        };
      });
      return next;
    });
  }, [scaleOverrides]);

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
  }) => {
    const employee = employeeById.get(employeeId);
    if (!employee) return [] as DiaEscala[];

    const [yearRaw, monthRaw] = selectedScaleMonth.split('-').map(Number);
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

  const classifyShift = useCallback((dia: DiaEscala): Exclude<PlanningShiftFilter, 'all' | 'folga'> | null => {
    if (dia.tipo !== 'trabalho') return null;

    const turnoRef = dia.turno || ((dia.horaInicio && dia.horaFim) ? `${dia.horaInicio}-${dia.horaFim}` : '');
    if (!turnoRef.includes('-')) return 'comercial';

    const startHour = horaInicialDoTurno(turnoRef);
    if (startHour === null) return 'comercial';
    if (startHour >= 12 && startHour < 18) return 'tarde';
    if (startHour >= 18 || startHour < 5) return 'noite';

    if (startHour >= 5 && startHour < 12) {
      if (turnoRef.includes('18:00') || turnoRef.includes('19:00') || turnoRef.includes('17:00')) {
        return 'comercial';
      }
      return 'manha';
    }

    return 'comercial';
  }, []);

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
      setToastMessage('Modo de edição ativado. Arraste para ajustar a escala.');
      return;
    }

    setIsPlanningEditMode(false);
    setToastMessage('Alterações de grade salvas.');
  };

  const applyManualPlanningOverride = useCallback((payload: ScaleOverridePayload, successMessage: string) => {
    const key = `${payload.colaboradorId}:${payload.data}`;

    setPlanningOverrides((prev) => ({
      ...prev,
      [key]: payload,
    }));

    setSuggestedPlanningKeys((prev) => prev.filter((item) => item !== key));

    void (async () => {
      try {
        if (onSaveScaleOverride) {
          const success = await onSaveScaleOverride(payload);
          if (success === false) {
            setToastMessage('Alteração aplicada localmente. Sincronização pendente.');
            return;
          }
        }

        setToastMessage(successMessage);
      } catch (error) {
        setToastMessage('Alteração aplicada localmente. Falha na sincronização com servidor.');
      }
    })();
  }, [onSaveScaleOverride]);

  const handleQuickToggleTimelineDay = useCallback((employeeId: string, day: string, current?: DiaEscala) => {
    const nextType: DiaEscala['tipo'] = current?.tipo === 'trabalho' ? 'folga' : 'trabalho';
    const payload: ScaleOverridePayload = {
      colaboradorId: employeeId,
      data: day,
      tipo: nextType,
      turno: nextType === 'trabalho' ? (current?.turno || '08:00-18:00') : undefined,
      descricao: nextType === 'trabalho' ? 'Ajuste manual rápido' : 'Folga manual rápida',
    };

    applyManualPlanningOverride(payload, `Dia atualizado para ${nextType === 'trabalho' ? 'trabalho' : 'folga'}.`);
  }, [applyManualPlanningOverride]);

  const handleQuickSetTimelineDay = useCallback((employeeId: string, day: string, tipo: DiaEscala['tipo'], turno?: string) => {
    const payload: ScaleOverridePayload = {
      colaboradorId: employeeId,
      data: day,
      tipo,
      turno: tipo === 'trabalho' ? (turno || '08:00-18:00') : undefined,
      descricao: tipo === 'folga' ? 'Folga manual' : `Turno manual (${turno || '08:00-18:00'})`,
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

      for (const key of suggestedPlanningKeys) {
        const override = planningOverrides[key];
        if (!override) continue;

        try {
          const success = await onSaveScaleOverride(override);
          if (success === false) {
            failedKeys.push(key);
            continue;
          }
          successCount += 1;
        } catch (error) {
          failedKeys.push(key);
        }
      }

      setSuggestedPlanningKeys(failedKeys);

      if (failedKeys.length === 0) {
        setToastMessage(`Escala confirmada (${successCount} ajuste(s) sincronizados).`);
      } else {
        setToastMessage(`Escala parcialmente confirmada. ${failedKeys.length} ajuste(s) pendente(s).`);
      }
    } finally {
      setIsSavingPlanning(false);
    }
  }, [isSavingPlanning, onSaveScaleOverride, planningOverrides, suggestedPlanningKeys]);

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

  const handleUpdateSwapStatus = async (id: string, status: Exclude<TurnoSwapStatus, 'pendente'>) => {
    if (!onUpdateTurnoSwapRequestStatus) return;

    const success = await onUpdateTurnoSwapRequestStatus(id, status);
    if (success !== false) {
      setToastMessage(`Solicitacao ${status === 'aprovada' ? 'aprovada' : 'rejeitada'} com sucesso.`);
    }
  };


  return {
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
    selectedPlanningDay,
    setSelectedPlanningDay,
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
    splitTurno: separarTurno,
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
    cltRealtimeAlerts,
    pendingTurnoSwapRequests,
    visibleCltToastAlerts,
    handleUpdateSwapStatus,
  };
}
