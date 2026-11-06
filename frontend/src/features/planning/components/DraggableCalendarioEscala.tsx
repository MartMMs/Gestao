import React, { useMemo, useRef, useState } from 'react';
import { DiaEscala } from '../../../utils/escalaCalculator';
import { THEME_GRADIENTS } from '../utils/themeColors';

interface DraggableCalendarioEscalaProps {
  escalas: DiaEscala[];
  year: number;
  month: number;
  dayRange?: { start: number; end: number };
  selectedMonth?: string;
  onMonthChange?: (month: string) => void;
  hideMonthBadge?: boolean;
  onDayClick?: (day: number) => void;
  onDayDrop?: (from: number, to: number, tipo: DiaEscala['tipo']) => void;
  isInteractive?: boolean;
  isDraggable?: boolean;
}

const DAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

export function DraggableCalendarioEscala({
  escalas,
  year,
  month,
  dayRange,
  selectedMonth,
  onMonthChange,
  hideMonthBadge = false,
  onDayClick,
  onDayDrop,
  isInteractive = false,
  isDraggable = false,
}: DraggableCalendarioEscalaProps) {
  const [draggedDay, setDraggedDay] = useState<number | null>(null);
  const monthInputRef = useRef<HTMLInputElement | null>(null);

  const monthLabel = useMemo(() => {
    const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [month, year]);

  const { daysInMonth, firstVisibleDayOffset, visibleDays, mapByDay, today } = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    const map = new Map<number, DiaEscala>();
    const currentDate = new Date();
    const todayDay =
      currentDate.getFullYear() === year && currentDate.getMonth() + 1 === month
        ? currentDate.getDate()
        : -1;

    const rangeStart = Math.max(1, dayRange?.start ?? 1);
    const rangeEnd = Math.min(days, dayRange?.end ?? days);
    const visible = rangeEnd >= rangeStart
      ? Array.from({ length: rangeEnd - rangeStart + 1 }, (_, index) => rangeStart + index)
      : [];

    const firstVisible = visible[0] || 1;
    const firstOffset = visible.length > 0
      ? new Date(year, month - 1, firstVisible).getDay()
      : 0;

    escalas.forEach((item) => {
      const [itemYear, itemMonth, itemDay] = item.data.split('-').map(Number);
      if (itemYear === year && itemMonth === month) {
        map.set(itemDay, item);
      }
    });

    return {
      daysInMonth: days,
      firstVisibleDayOffset: firstOffset,
      visibleDays: visible,
      mapByDay: map,
      today: todayDay,
    };
  }, [dayRange?.end, dayRange?.start, escalas, month, year]);

  const cltViolationDays = useMemo(() => {
    const violations = new Set<number>();
    let consecutiveWorkDays = 0;

    for (let day = 1; day <= daysInMonth; day += 1) {
      const tipo = mapByDay.get(day)?.tipo || 'trabalho';
      if (tipo === 'trabalho') {
        consecutiveWorkDays += 1;
        if (consecutiveWorkDays >= 7) {
          violations.add(day);
        }
      } else {
        consecutiveWorkDays = 0;
      }
    }

    return violations;
  }, [daysInMonth, mapByDay]);

  const getGradient = (tipo: DiaEscala['tipo']) => {
    switch (tipo) {
      case 'trabalho':
        return THEME_GRADIENTS.work;
      case 'folga':
        return THEME_GRADIENTS.rest;
      case 'fds':
        return THEME_GRADIENTS.weekend;
      default:
        return '';
    }
  };

  const getLabel = (dia?: DiaEscala) => {
    if (!dia) return 'TRAB';
    const isHoliday = Boolean(dia.feriadoNome || dia.descricao?.toLowerCase().includes('feriado'));
    if (isHoliday) return 'FER';
    if (dia.tipo === 'folga') return 'FOLGA';
    if (dia.tipo === 'fds') return 'FDS';
    if (dia.turno) return dia.turno.split('-')[0];
    return 'TRAB';
  };

  const handleDragStart = (day: number, event: React.DragEvent<HTMLButtonElement>) => {
    if (!isDraggable) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(day));
    setDraggedDay(day);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('ring-2', 'ring-primary');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('ring-2', 'ring-primary');
  };

  const handleDrop = (day: number, e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('ring-2', 'ring-primary');

    if (!isDraggable || draggedDay === null || draggedDay === day) {
      setDraggedDay(null);
      return;
    }

    const escalaFrom = mapByDay.get(draggedDay);
    if (escalaFrom && onDayDrop) {
      onDayDrop(draggedDay, day, escalaFrom.tipo);
    }
    setDraggedDay(null);
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

  return (
    <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-headline text-primary">📅 Calendário de Escalas</h3>
        {!hideMonthBadge && onMonthChange && selectedMonth ? (
          <div className="relative">
            <button
              type="button"
              onClick={openMonthPicker}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
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
          <span className="text-[11px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary">
            {monthLabel}
          </span>
        ) : null}
        {isDraggable && (
          <span className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-primary/20 text-primary">
            🖱️ Arrastar para reorganizar
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center mb-3">
        {DAY_HEADERS.map((day) => (
          <span key={day} className="text-[11px] font-bold text-primary/70 uppercase tracking-widest py-2">
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: firstVisibleDayOffset }).map((_, index) => (
          <div key={`empty-${index}`} className="h-24 rounded-xl bg-surface-container-low/20 border border-outline-variant/5" />
        ))}

        {visibleDays.map((day) => {
          const escala = mapByDay.get(day);
          const hasCltAlert = cltViolationDays.has(day);
          const weekDay = new Date(year, month - 1, day).getDay();
          const isWeekend = weekDay === 0 || weekDay === 6;
          const isToday = day === today;
          const isPast = day < today;
          const isDraggedOver = draggedDay === day;

          const bgGradient = escala ? getGradient(escala.tipo) : '';
          const fullBgClass = escala
            ? `bg-gradient-to-br ${bgGradient} border-primary/60`
            : 'bg-surface-container-low/50 border-outline-variant/20';

          const weekendClass = isWeekend ? 'ring-1 ring-inset ring-outline-variant/25' : '';
          const pastClass = isPast && day !== today ? 'opacity-50' : '';
          const todayClass = isToday ? 'ring-2 ring-primary shadow-lg' : '';
          const dragOverClass = isDraggedOver ? 'ring-2 ring-primary scale-105' : '';
          const interactiveClass =
            isInteractive || isDraggable ? 'cursor-pointer hover:shadow-md hover:scale-105 transition-all' : '';

          return (
            <button
              key={day}
              draggable={isDraggable}
              onDragStart={(event) => handleDragStart(day, event)}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(day, e)}
              onClick={() => onDayClick?.(day)}
              disabled={!isInteractive && !isDraggable}
              className={`h-24 rounded-xl border p-3 text-left flex flex-col justify-between transition-all ${fullBgClass} ${weekendClass} ${pastClass} ${todayClass} ${dragOverClass} ${interactiveClass} ${hasCltAlert ? 'border-error/60' : ''} disabled:cursor-default ${
                isDraggable && draggedDay === day ? 'opacity-60' : ''
              }`}
              title={`${escala?.descricao || 'Sem escala definida'}${hasCltAlert ? ' - Alerta CLT: descanso semanal' : ''}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-on-surface'}`}>{day}</div>
                {hasCltAlert && (
                  <span className="text-[10px] font-black text-error">!</span>
                )}
                {escala?.folgaDominicalConfigurada && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/80 text-on-primary">
                    Dom
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                <div className={`text-[11px] font-black tracking-wide ${escala?.tipo === 'folga' ? 'text-secondary' : escala?.tipo === 'fds' ? 'text-tertiary' : 'text-on-surface-variant'}`}>
                  {getLabel(escala)}
                </div>

                {escala?.tipo === 'trabalho' && escala?.turno?.includes('-') && (
                  <div className="text-[10px] font-semibold text-on-surface-variant truncate max-w-full">
                    {escala.turno.split('-')[1] || ''}
                  </div>
                )}

                {/* Indicador de dragável */}
                {isDraggable && escala && (
                  <div className="text-[10px] text-primary-dim font-bold mt-1">
                    ⇄ Mover
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legenda melhorada */}
      <div className="mt-5 pt-4 border-t border-outline-variant/10 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-surface-container border border-outline-variant/30"></span>
          <span className="text-[10px] text-on-surface-variant font-bold">Trabalho</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-secondary-container/45 border border-secondary/50"></span>
          <span className="text-[10px] text-on-surface-variant font-bold">Folga</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-tertiary/25 border border-tertiary/50"></span>
          <span className="text-[10px] text-on-surface-variant font-bold">FDS</span>
        </div>
        {(isInteractive || isDraggable) && (
          <div className="flex items-center gap-2">
            <span className="text-lg">{isDraggable ? '⇄' : '👆'}</span>
            <span className="text-[10px] text-on-surface-variant font-bold">
              {isDraggable ? 'Arrastar' : 'Clicável'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
