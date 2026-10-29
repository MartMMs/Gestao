import React, { useEffect, useMemo, useRef, useState } from 'react';
import { horaInicialDoTurno } from '../../../utils/escalaCalculator';
import { Employee, Appointment } from '../../../types';
import { gerarEscalaComRegras, DiaEscala } from '../../../utils/escalaCalculator';

interface TimelineGanttProps {
  employees: Employee[];
  appointments?: Appointment[];
  month: string; // "2026-04"
  dayRange?: { start: number; end: number };
  selectedMonth?: string;
  onMonthChange?: (month: string) => void;
  hideMonthBadge?: boolean;
  isEditable?: boolean;
  suggestedKeys?: string[];
  onQuickToggleDay?: (employeeId: string, day: string, current?: DiaEscala) => void;
  onQuickSetDay?: (employeeId: string, day: string, tipo: DiaEscala['tipo'], turno?: string) => void;
  onClick?: (empleoyeeId: string, day: string) => void;
  onShiftDrop?: (fromEmployeeId: string, fromDay: string, toEmployeeId: string, toDay: string) => void;
  onReplicate?: (employeeId: string, fromDay: number, toDay: number, tipo?: DiaEscala['tipo']) => void;
  minStaffRequired?: number;
  overrides?: Array<{
    colaboradorId: string;
    data: string;
    tipo: DiaEscala['tipo'];
    turno?: string;
    descricao?: string;
  }>;
}

export function TimelineGantt({ employees, appointments, month, dayRange, selectedMonth, onMonthChange, hideMonthBadge = false, isEditable = false, suggestedKeys = [], onQuickToggleDay, onQuickSetDay, onClick, onShiftDrop, onReplicate, minStaffRequired, overrides = [] }: TimelineGanttProps) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [quickMenu, setQuickMenu] = useState<{
    employeeId: string;
    day: string;
    x: number;
    y: number;
  } | null>(null);
  const monthInputRef = useRef<HTMLInputElement | null>(null);
  const [year, monthNum] = month.split('-').map(Number);
  const suggestedKeySet = useMemo(() => new Set(suggestedKeys), [suggestedKeys]);

  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const visibleDays = useMemo(() => {
    const start = Math.max(1, dayRange?.start ?? 1);
    const end = Math.min(daysInMonth, dayRange?.end ?? daysInMonth);
    if (end < start) return [] as number[];
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [dayRange?.end, dayRange?.start, daysInMonth]);

  const monthLabel = useMemo(() => {
    const label = new Date(year, monthNum - 1, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [year, monthNum]);

  const dayMeta = useMemo(() => {
    const weekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const currentDate = new Date();
    const todayDay = currentDate.getFullYear() === year && currentDate.getMonth() + 1 === monthNum ? currentDate.getDate() : -1;

    return visibleDays.map((day) => {
      const date = new Date(year, monthNum - 1, day);
      const weekday = date.getDay();
      return {
        day,
        weekday,
        weekdayLabel: weekdayLabels[weekday],
        isWeekend: weekday === 0 || weekday === 6,
        isToday: day === todayDay,
      };
    });
  }, [monthNum, visibleDays, year]);

  const overridesMap = useMemo(() => {
    const map = new Map<string, { tipo: DiaEscala['tipo']; turno?: string; descricao?: string }>();
    overrides.forEach((override) => {
      map.set(`${override.colaboradorId}:${override.data}`, {
        tipo: override.tipo,
        turno: override.turno,
        descricao: override.descricao,
      });
    });
    return map;
  }, [overrides]);

  const escalasByEmployee = useMemo(() => {
    const map = new Map<string, Map<number, DiaEscala>>();

    employees.forEach((emp) => {
      const firstDay = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      const daysInMonth = new Date(year, monthNum, 0).getDate();
      const escala = gerarEscalaComRegras(
        {
          tipo: emp.tipoEscala || '6x1',
          dataInicio: firstDay,
        },
        daysInMonth,
        { folgasDomingoNoMes: emp.folgasDomingoNoMes ?? 2 },
      );
      const dayMap = new Map<number, DiaEscala>();

      escala.forEach((dia) => {
        const override = overridesMap.get(`${emp.id}:${dia.data}`);
        const hasTurno = Boolean(override?.turno && override.turno.includes('-'));
        const [horaInicio, horaFim] = hasTurno ? (override?.turno || '').split('-') : [undefined, undefined];

        const diaFinal: DiaEscala = override
          ? {
              ...dia,
              tipo: override.tipo,
              turno: override.tipo === 'trabalho' ? (override.turno || dia.turno) : undefined,
              horaInicio: override.tipo === 'trabalho' ? (horaInicio || dia.horaInicio) : undefined,
              horaFim: override.tipo === 'trabalho' ? (horaFim || dia.horaFim) : undefined,
              descricao: override.descricao ?? dia.descricao,
            }
          : dia;

        const [_, __, day] = diaFinal.data.split('-').map(Number);
        dayMap.set(day, diaFinal);
      });

      map.set(emp.id, dayMap);
    });

    return map;
  }, [employees, year, monthNum, overridesMap]);

  // Coverage: count how many employees are working per day
  const coverageByDay = useMemo(() => {
    const counts = new Map<number, number>();
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) counts.set(d, 0);

    escalasByEmployee.forEach((dayMap) => {
      for (const [day, dia] of dayMap.entries()) {
        if (dia.tipo === 'trabalho') counts.set(day, (counts.get(day) || 0) + 1);
      }
    });

    return counts;
  }, [escalasByEmployee, year, monthNum]);

  // Calcula a demanda de agendamentos reais naquele dia
  const demandByDay = useMemo(() => {
    const counts = new Map<number, number>();
    if (!appointments) return counts;
    
    appointments.forEach(app => {
      const [y, m, d] = app.date.split('-').map(Number);
      if (y === year && m === monthNum) {
        counts.set(d, (counts.get(d) || 0) + 1);
      }
    });
    
    return counts;
  }, [appointments, year, monthNum]);

  // Calcula cobertura de Habilidades Vitais (ex: Primeiros Socorros)
  const vitalSkillsCoverageByDay = useMemo(() => {
    const coverage = new Map<number, boolean>();
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) coverage.set(d, false);

    escalasByEmployee.forEach((dayMap, employeeId) => {
      const emp = employees.find((e) => e.id === employeeId);
      const hasVitalSkill = emp?.habilidades?.some((h) => 
        h.toLowerCase().includes('primeiros socorros') || 
        h.toLowerCase().includes('emergencia') || 
        h.toLowerCase().includes('emergência')
      );

      if (hasVitalSkill) {
        for (const [day, dia] of dayMap.entries()) {
          if (dia.tipo === 'trabalho') {
            coverage.set(day, true);
          }
        }
      }
    });

    return coverage;
  }, [escalasByEmployee, employees, year, monthNum]);

  // Alerta simples de descanso semanal: marca a partir do 7o dia consecutivo de trabalho
  const cltViolationByEmployee = useMemo(() => {
    const map = new Map<string, Set<number>>();

    escalasByEmployee.forEach((dayMap, employeeId) => {
      let consecutiveWorkDays = 0;
      const violations = new Set<number>();

      for (let day = 1; day <= daysInMonth; day += 1) {
        const dia = dayMap.get(day);
        const isWorkingDay = (dia?.tipo || 'trabalho') === 'trabalho';

        if (isWorkingDay) {
          consecutiveWorkDays += 1;
          if (consecutiveWorkDays >= 7) {
            violations.add(day);
          }
        } else {
          consecutiveWorkDays = 0;
        }
      }

      map.set(employeeId, violations);
    });

    return map;
  }, [daysInMonth, escalasByEmployee]);

  const getBackgroundColor = (tipo: DiaEscala['tipo'], isWeekend: boolean, turno?: string) => {
    const weekendClass = isWeekend ? 'ring-1 ring-inset ring-outline-variant/25' : '';
    if (tipo === 'folga' || tipo === 'fds') return `bg-surface-variant/40 shadow-inner bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(0,0,0,0.03)_5px,rgba(0,0,0,0.03)_10px)] dark:bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(255,255,255,0.03)_5px,rgba(255,255,255,0.03)_10px)] hover:opacity-80 ${weekendClass}`;
    if (tipo === 'trabalho') {
      if (!turno) return `bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 ${weekendClass}`;
      const startHour = horaInicialDoTurno(turno) ?? -1;
      if (startHour >= 5 && startHour < 12) {
        if (turno.includes('18:00') || turno.includes('19:00') || turno.includes('17:00')) return `bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 ${weekendClass}`;
        return `bg-blue-600 text-white shadow-sm hover:bg-blue-700 ${weekendClass}`;
      }
      if (startHour >= 12 && startHour < 18) return `bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 ${weekendClass}`;
      return `bg-purple-700 text-white shadow-sm hover:bg-purple-800 ${weekendClass}`;
    }
    return `bg-surface-container-low/50 ${weekendClass}`;
  };

  const getCellIconAndLabel = (dia?: DiaEscala) => {
    if (!dia) return null;
    const isHoliday = Boolean(dia.feriadoNome || dia.descricao?.toLowerCase().includes('feriado'));
    if (isHoliday) return { label: 'FER', icon: 'celebration' };
    if (dia.tipo === 'folga') return { label: 'FOLGA', icon: 'event_busy' };
    if (dia.tipo === 'fds') return { label: 'FDS', icon: 'weekend' };
    if (dia.turno) {
      const startHour = horaInicialDoTurno(dia.turno) ?? -1;
      let icon = 'work';
      if (startHour >= 12 && startHour < 18) icon = 'partly_cloudy_day';
      else if (startHour >= 18 || startHour < 5) icon = 'dark_mode';
      else if (startHour >= 5 && startHour < 12) {
        if (dia.turno.includes('18:00') || dia.turno.includes('19:00') || dia.turno.includes('17:00')) icon = 'routine';
        else icon = 'light_mode';
      }
      return { label: dia.turno.split('-')[0], icon };
    }
    return { label: 'TRAB', icon: 'work' };
  };

  const openMonthPicker = () => {
    const input = monthInputRef.current;
    if (!input) return;
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === 'function') {
      pickerInput.showPicker();
      return;
    }
    input.click();
  };

  useEffect(() => {
    if (!quickMenu) return;

    const closeMenu = () => setQuickMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [quickMenu]);

  return (
    <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/10 overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-outline-variant/10 bg-surface-container-low flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-on-surface">Linha do Tempo de Escala</h3>
        {!hideMonthBadge && onMonthChange && selectedMonth ? (
          <div className="relative">
            <button
              type="button"
              onClick={openMonthPicker}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
            >
              <span>{monthLabel}</span>
              <span className="material-symbols-outlined text-[14px]">expand_more</span>
            </button>
            <input
              ref={monthInputRef}
              type="month"
              value={selectedMonth}
              onChange={(event) => onMonthChange(event.target.value)}
              tabIndex={-1}
              aria-hidden="true"
              className="absolute w-0 h-0 opacity-0 pointer-events-none"
            />
          </div>
        ) : !hideMonthBadge ? (
          <span className="text-xs font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary">
            {monthLabel}
          </span>
        ) : null}
      </div>

      {/* Header com dias */}
      <div className="overflow-x-auto custom-scrollbar">
        <div className="min-w-fit">
          {/* Cabeçalho da tabela */}
          <div className="flex flex-col sticky left-0 z-10">
            <div className="flex items-center">
              <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-2 sm:p-3 font-bold text-xs sm:text-sm text-on-surface sticky left-0 z-20 truncate">
                Colaborador
              </div>

              <div className="flex-1 p-3 bg-surface-container-low border-b border-outline-variant/10 text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
                Grade da equipe
              </div>
            </div>

            {/* Coverage summary */}
            <div className="flex items-center">
              <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-2 sm:p-3 font-bold text-[9px] sm:text-[11px] uppercase tracking-tighter sm:tracking-[0.15em] text-on-surface-variant sticky left-0 z-20 truncate">
                Cobertura diária
              </div>

              <div className="flex gap-0.5 p-2 bg-surface-container-low border-b border-outline-variant/10">
                {dayMeta.map((meta) => {
                  const count = coverageByDay.get(meta.day) || 0;
                  const target = minStaffRequired || 0;
                  const isLow = target > 0 && count < target;
                  
                  let heatClass = 'bg-surface-container-lowest text-on-surface border-outline-variant/20';
                  if (target > 0) {
                    if (isLow) {
                      heatClass = 'bg-orange-100 text-orange-800 border-orange-300';
                    } else {
                      heatClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                    }
                  }

                  return (
                    <div
                      key={`summary-${meta.day}`}
                      className={`w-12 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg border transition-colors ${heatClass} ${meta.isWeekend ? 'ring-1 ring-inset ring-outline-variant/20' : ''}`}
                      title={isLow ? 'Cobertura abaixo do mínimo' : 'Cobertura adequada'}
                    >
                      <div className="flex items-center gap-0.5" aria-label={`Cobertura ${count}/${target}`}>
                        {isLow && <span className="text-[10px] font-black">!</span>}
                        <span>{count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Heatmap summary (Gargalos de Demanda) */}
            <div className="flex items-center">
              <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-2 sm:p-3 font-bold text-[9px] sm:text-[11px] uppercase tracking-tighter sm:tracking-[0.15em] text-on-surface-variant sticky left-0 z-20 truncate" title="Sinaliza gargalos cruzando agenda com cobertura">
                Gargalos (Demanda)
              </div>

              <div className="flex gap-0.5 p-2 bg-surface-container-low border-b border-outline-variant/10">
                {dayMeta.map((meta) => {
                  const coverage = coverageByDay.get(meta.day) || 0;
                  const demand = demandByDay.get(meta.day) || 0;
                  const capacity = coverage * 8; // Estimativa: 8 agendamentos por dia por funcionário
                  
                  const isBottleneck = demand > capacity || (coverage === 0 && demand > 0);
                  const isWarning = demand > 0 && demand >= capacity * 0.8 && !isBottleneck;
                  
                  let heatClass = 'bg-surface-container-lowest text-outline-variant/30 border-outline-variant/20';
                  let icon = 'horizontal_rule';
                  let tooltip = 'Sem demanda crítica';

                  if (isBottleneck) {
                    heatClass = 'bg-error-container text-error border-error/30';
                    icon = 'warning';
                    tooltip = `Gargalo Operacional! Demanda: ${demand} | Capacidade est.: ${capacity}`;
                  } else if (isWarning) {
                    heatClass = 'bg-amber-100 text-amber-800 border-amber-300';
                    icon = 'trending_up';
                    tooltip = `Atenção: Capacidade no limite. Demanda: ${demand} | Capacidade est.: ${capacity}`;
                  } else if (demand > 0) {
                    heatClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                    icon = 'check_circle';
                    tooltip = `Demanda controlada. Demanda: ${demand} | Capacidade est.: ${capacity}`;
                  }

                  return (
                    <div
                      key={`heatmap-${meta.day}`}
                      className={`w-12 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg border transition-colors ${heatClass} ${meta.isWeekend ? 'ring-1 ring-inset ring-outline-variant/20' : ''}`}
                      title={tooltip}
                    >
                      <span className={`material-symbols-outlined text-[14px] ${isBottleneck ? 'animate-pulse' : ''}`}>{icon}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Vital Skills summary (Habilidades Vitais) */}
            <div className="flex items-center">
              <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-2 sm:p-3 font-bold text-[9px] sm:text-[11px] uppercase tracking-tighter sm:tracking-[0.15em] text-on-surface-variant sticky left-0 z-20 truncate" title="Garante que há profissionais com Primeiros Socorros no dia">
                Habilidades Vitais
              </div>

              <div className="flex gap-0.5 p-2 bg-surface-container-low border-b border-outline-variant/10">
                {dayMeta.map((meta) => {
                  const hasVital = vitalSkillsCoverageByDay.get(meta.day);
                  const count = coverageByDay.get(meta.day) || 0;
                  const isWorkingDay = count > 0;

                  let heatClass = 'bg-surface-container-lowest text-outline-variant/30 border-outline-variant/20';
                  let icon = 'horizontal_rule';
                  let tooltip = 'Sem operação (Spa fechado)';

                  if (isWorkingDay && !hasVital) {
                    heatClass = 'bg-orange-100 text-orange-800 border-orange-300';
                    icon = 'health_and_safety';
                    tooltip = 'Alerta: Nenhum profissional com Primeiros Socorros escalado!';
                  } else if (isWorkingDay && hasVital) {
                    heatClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                    icon = 'verified_user';
                    tooltip = 'Cobertura vital garantida (Primeiros Socorros)';
                  }

                  return (
                    <div
                      key={`vital-${meta.day}`}
                      className={`w-12 h-7 flex items-center justify-center text-[11px] font-bold rounded-lg border transition-colors ${heatClass} ${meta.isWeekend ? 'ring-1 ring-inset ring-outline-variant/20' : ''}`}
                      title={tooltip}
                    >
                      <span className={`material-symbols-outlined text-[14px]`}>{icon}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dias do mês */}
            <div className="flex items-center">
              <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low border-r border-outline-variant/10 p-2 sm:p-3 font-bold text-[9px] sm:text-[11px] uppercase tracking-tighter sm:tracking-[0.15em] text-on-surface-variant sticky left-0 z-20 truncate">
                Dias
              </div>

              <div className="flex gap-0.5 p-2 bg-surface-container-low border-b border-outline-variant/10">
                {dayMeta.map((meta) => (
                  <div
                    key={meta.day}
                    className={`relative w-12 h-10 flex flex-col items-center justify-center rounded-lg border ${
                      meta.isToday ? 'bg-primary/10 border-primary/30 text-primary' : meta.isWeekend ? 'bg-surface-container border-outline-variant/10 text-on-surface' : 'bg-surface-container-lowest border-outline-variant/10 text-on-surface-variant'
                    }`}
                  >
                    {meta.isToday && <span className="absolute -top-1.5 bg-primary text-on-primary text-[7px] px-1 rounded-sm uppercase font-bold shadow-sm">Hoje</span>}
                    <span className="text-[11px] font-bold leading-none">{meta.day}</span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide leading-none mt-1">{meta.weekdayLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rows de colaboradores */}
          <div>
            {employees.map((emp) => {
              const dataPorDia = escalasByEmployee.get(emp.id) || new Map();
              return (
                <div key={emp.id} className="flex items-center border-b border-outline-variant/10 last:border-b-0 hover:bg-surface-container-low/50 transition-colors">
                  {/* Nome do colaborador */}
                  <div className="w-28 sm:w-48 shrink-0 bg-surface-container-low p-2 sm:p-3 text-xs sm:text-sm font-bold text-on-surface truncate border-r border-outline-variant/10 sticky left-0 z-10">
                    <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                      <img
                        src={emp.avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${emp.name}`}
                        alt={emp.name}
                        className="w-6 h-6 rounded-full"
                      />
                      <span className="truncate">{emp.name}</span>
                    </div>
                  </div>

                  {/* Células de dias */}
                  <div className="flex gap-0.5 p-2">
                    {dayMeta.map((meta) => {
                      const dia = dataPorDia.get(meta.day);
                      const count = coverageByDay.get(meta.day) || 0;
                      const isLow = typeof minStaffRequired === 'number' && count < minStaffRequired;
                      const hasCltAlert = cltViolationByEmployee.get(emp.id)?.has(meta.day) || false;
                      const hasAlert = isLow || hasCltAlert;
                      const cellKey = `${emp.id}:${meta.day}`;
                      const cellDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(meta.day).padStart(2, '0')}`;
                      const isDragTarget = dragOverKey === cellKey;
                      const isSuggested = suggestedKeySet.has(cellKey);
                      const borderClass = hasCltAlert
                        ? 'border-amber-400'
                        : isLow
                          ? 'border-orange-400'
                          : 'border-outline-variant/20';
                      return (
                        <div key={meta.day} className="relative group">
                          <button
                            type="button"
                            draggable={isEditable}
                            onDragStart={(e) => {
                              if (!isEditable) return;
                              setDragOverKey(null);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', JSON.stringify({ empId: emp.id, day: meta.day }));
                            }}
                            onDragEnd={() => {
                              if (!isEditable) return;
                              setDragOverKey(null);
                            }}
                            onDragOver={(e) => {
                              if (!isEditable) return;
                              e.preventDefault();
                              setDragOverKey(cellKey);
                            }}
                            onDragLeave={() => {
                              if (!isEditable) return;
                              setDragOverKey((current) => (current === cellKey ? null : current));
                            }}
                            onDrop={(e) => {
                              if (!isEditable) return;
                              e.preventDefault();
                              setDragOverKey(null);

                              try {
                                const payload = JSON.parse(e.dataTransfer.getData('text/plain'));
                                if (payload && payload.empId) {
                                  const fromEmpId = payload.empId;
                                  const fromDay = `${year}-${String(monthNum).padStart(2, '0')}-${String(payload.day).padStart(2, '0')}`;
                                  const toDay = `${year}-${String(monthNum).padStart(2, '0')}-${String(meta.day).padStart(2, '0')}`;
                                  onShiftDrop?.(fromEmpId, fromDay, emp.id, toDay);
                                }
                              } catch (err) {
                                // ignore invalid drag payload
                              }
                            }}
                            onClick={() => {
                              if (isEditable && onQuickToggleDay) {
                                onQuickToggleDay(emp.id, cellDate, dia);
                                return;
                              }

                              onClick?.(emp.id, cellDate);
                            }}
                            onContextMenu={(event) => {
                              if (!isEditable) return;
                              event.preventDefault();
                              setQuickMenu({
                                employeeId: emp.id,
                                day: cellDate,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                            className={`relative w-12 h-12 flex flex-col items-center justify-center rounded-lg transition-all cursor-pointer border ${
                              borderClass
                            } ${isSuggested ? 'border-dashed opacity-90' : ''} hover:border-primary/50 ${isDragTarget ? 'ring-2 ring-primary/80 shadow-md' : ''} ${getBackgroundColor(dia?.tipo || 'trabalho', meta.isWeekend, dia?.turno)}`}
                            title={`${emp.name} | ${dia?.data?.split('-').reverse().join('/') || ''} | ${dia?.tipo?.toUpperCase() || 'TRABALHO'}${dia?.tipo === 'trabalho' && dia?.turno ? ` (${dia.turno})` : ''}${dia?.descricao ? ` - ${dia.descricao}` : ''}${hasCltAlert ? ' | ALERTA CLT' : ''}${isSuggested ? ' | Sugestão automática' : ''}`}
                          >
                            {(() => {
                              const cellData = getCellIconAndLabel(dia);
                              return (
                                <div className={`flex flex-col items-center gap-0.5 ${dia?.tipo === 'trabalho' ? 'text-white' : 'text-on-surface-variant opacity-70'}`}>
                                  {cellData && cellData.icon && <span className="material-symbols-outlined text-[14px] leading-none">{cellData.icon}</span>}
                                  <span className="text-[8px] font-black leading-none">{cellData?.label}</span>
                                </div>
                              );
                            })()}
                            {hasAlert && (
                              <span className={`absolute top-0.5 left-0.5 text-[10px] font-black drop-shadow-sm ${hasCltAlert ? 'text-amber-300' : 'text-orange-300'}`}>!</span>
                            )}
                            {isSuggested && (
                              <span className="absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            )}
                          </button>

                          {/* Replicate handle (right-bottom small area) */}
                          {isEditable && (
                            <div
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onReplicate?.(emp.id, meta.day, daysInMonth, dia?.tipo);
                              }}
                              data-replicate-end={meta.day}
                              className="absolute right-0.5 bottom-0.5 w-2.5 h-2.5 rounded-sm bg-outline-variant/40 hover:bg-primary/70 cursor-grab z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="p-4 bg-surface-container-low border-t border-outline-variant/10 flex flex-wrap gap-4 items-center justify-center">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">light_mode</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Manhã</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">partly_cloudy_day</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Tarde</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-purple-700 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">dark_mode</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Noite</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-emerald-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">routine</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Comercial / Outros</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-surface-variant/60 bg-[repeating-linear-gradient(-45deg,transparent,transparent_2px,rgba(0,0,0,0.1)_2px,rgba(0,0,0,0.1)_4px)] border border-outline-variant/30"></span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">Folga / FDS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-orange-100 border border-orange-300 flex items-center justify-center text-[9px] font-black text-orange-800">!</span>
          <span className="text-[10px] text-on-surface-variant font-bold">Cobertura baixa</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-surface-container border border-amber-400 flex items-center justify-center text-[9px] font-black text-amber-400">!</span>
          <span className="text-[10px] text-on-surface-variant font-bold">Alerta CLT</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-error-container border border-error/30 flex items-center justify-center text-[9px] font-black text-error animate-pulse"><span className="material-symbols-outlined text-[10px]">warning</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold">Gargalo de Demanda</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-orange-100 border border-orange-300 flex items-center justify-center text-[9px] font-black text-orange-800"><span className="material-symbols-outlined text-[10px]">health_and_safety</span></span>
          <span className="text-[10px] text-on-surface-variant font-bold">Sem Hab. Vital</span>
        </div>
      </div>

      {isEditable && quickMenu && (
        <div
          className="fixed z-50 rounded-xl border border-outline-variant/25 bg-surface-container-high shadow-2xl p-2 flex flex-col gap-2 min-w-40"
          style={{ top: quickMenu.y + 8, left: quickMenu.x - 40 }}
        >
          <div className="border-b border-outline-variant/20 pb-2 mb-1 px-1">
            <p className="text-[10px] font-bold text-primary uppercase tracking-widest leading-tight">
              {employees.find((e) => e.id === quickMenu.employeeId)?.name?.split(' ')[0]}
            </p>
            <p className="text-[9px] text-on-surface-variant mt-0.5">
              {quickMenu.day.split('-').reverse().join('/')}
            </p>
          </div>
          <div className="flex items-center gap-1 w-full justify-between">
            {[
              { label: 'M', tipo: 'trabalho' as const, turno: '06:00-14:00' },
              { label: 'T', tipo: 'trabalho' as const, turno: '14:00-22:00' },
              { label: 'N', tipo: 'trabalho' as const, turno: '22:00-06:00' },
              { label: 'F', tipo: 'folga' as const, turno: undefined },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  onQuickSetDay?.(quickMenu.employeeId, quickMenu.day, option.tipo, option.turno);
                  setQuickMenu(null);
                }}
                className="w-8 h-8 flex-1 rounded-lg border border-outline-variant/20 bg-surface-container-low text-[11px] font-bold text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
                title={
                  option.label === 'M'
                    ? 'Manhã (06:00-14:00)'
                    : option.label === 'T'
                      ? 'Tarde (14:00-22:00)'
                      : option.label === 'N'
                        ? 'Noite (22:00-06:00)'
                        : 'Marcar Folga'
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
