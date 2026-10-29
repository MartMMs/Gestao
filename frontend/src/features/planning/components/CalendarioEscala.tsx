import React, { useMemo, useRef } from 'react';
import { horaInicialDoTurno } from '../../../utils/escalaCalculator';
import { DiaEscala } from '../../../utils/escalaCalculator';

interface CalendarioEscalaProps {
  escalas: DiaEscala[];
  year: number;
  month: number; // 1-12
  dayRange?: { start: number; end: number };
  selectedMonth?: string;
  onMonthChange?: (month: string) => void;
  hideMonthBadge?: boolean;
  onDayClick?: (day: number) => void;
  isInteractive?: boolean;
}

const DAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

export function CalendarioEscala({ escalas, year, month, dayRange, selectedMonth, onMonthChange, hideMonthBadge = false, onDayClick, isInteractive = false }: CalendarioEscalaProps) {
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
    const todayDay = currentDate.getFullYear() === year && currentDate.getMonth() + 1 === month 
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
    <div className="bg-surface-container-lowest p-3 sm:p-6 rounded-2xl sm:rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
        <h3 className="text-lg font-headline text-primary">📅 Calendário de Escalas</h3>
        {!hideMonthBadge && onMonthChange && selectedMonth ? (
          <div className="relative">
            <button
              type="button"
              onClick={openMonthPicker}
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
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
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] px-3 py-1 rounded-full bg-primary/20 text-primary">
            {monthLabel}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-3">
        {DAY_HEADERS.map((day) => (
          <span key={day} className="text-[8px] sm:text-[10px] font-bold text-primary/70 uppercase tracking-widest py-1 sm:py-2">
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{day.charAt(0)}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: firstVisibleDayOffset }).map((_, index) => (
          <div key={`empty-${index}`} className="h-16 sm:h-20 rounded-lg sm:rounded-xl bg-surface-container-low/20 border border-outline-variant/5" />
        ))}

        {visibleDays.map((day) => {
          const escala = mapByDay.get(day);
          const weekDay = new Date(year, month - 1, day).getDay();
          const isWeekend = weekDay === 0 || weekDay === 6;
          const isTrabalho = escala?.tipo === 'trabalho';
          const isFolga = escala?.tipo === 'folga';
          const isFds = escala?.tipo === 'fds';
          const isHoliday = Boolean(escala?.feriadoNome || escala?.descricao?.toLowerCase().includes('feriado'));
          const hasCltAlert = cltViolationDays.has(day);
          const isFolgaDominicalConfigurada = Boolean(escala?.folgaDominicalConfigurada);
          const isToday = day === today;
          const isPast = day < today;

          let bgClass = 'bg-surface-container-low/50 border-outline-variant/20';
          let textClass = 'text-on-surface-variant';
          let icon = '';

          if (isFolga || isFds) {
            bgClass = 'bg-surface-variant/40 border-outline-variant/30 shadow-inner bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(0,0,0,0.03)_5px,rgba(0,0,0,0.03)_10px)] dark:bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(255,255,255,0.03)_5px,rgba(255,255,255,0.03)_10px)]';
            textClass = 'text-on-surface-variant';
            icon = isHoliday ? 'celebration' : (isFolga ? 'event_busy' : 'weekend');
          } else if (isTrabalho) {
            textClass = 'text-white';
            const t = escala?.turno || '';
            const startHour = horaInicialDoTurno(t) ?? -1;
            
            if (startHour >= 12 && startHour < 18) {
              bgClass = 'bg-indigo-600 border-indigo-700 shadow-md hover:bg-indigo-700';
              icon = 'partly_cloudy_day';
            } else if (startHour >= 18 || startHour < 5) {
              bgClass = 'bg-purple-700 border-purple-800 shadow-md hover:bg-purple-800';
              icon = 'dark_mode';
            } else if (startHour >= 5 && startHour < 12) {
              if (t.includes('18:00') || t.includes('19:00') || t.includes('17:00')) {
                bgClass = 'bg-emerald-600 border-emerald-700 shadow-md hover:bg-emerald-700'; // Comercial
                icon = 'routine';
              } else {
                bgClass = 'bg-blue-600 border-blue-700 shadow-md hover:bg-blue-700'; // Manhã
                icon = 'light_mode';
              }
            } else {
              bgClass = 'bg-emerald-600 border-emerald-700 shadow-md hover:bg-emerald-700'; // Fallback
              icon = 'work';
            }
          }

          const weekendClass = isWeekend ? 'ring-1 ring-inset ring-outline-variant/25' : '';
          const pastClass = isPast && day !== today ? 'opacity-50' : '';
          const todayClass = isToday ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface shadow-lg' : '';
          const interactiveClass = isInteractive ? 'cursor-pointer hover:shadow-md hover:scale-105 transition-all' : '';

          const primaryLabel = isFolga
            ? (isHoliday ? 'FER' : 'FOLGA')
            : isFds
              ? (isHoliday ? 'FER' : 'FDS')
              : isHoliday
                ? 'FER'
                : escala?.turno
                  ? escala.turno.split('-')[0]
                  : 'TRAB';

          const secondaryLabel = isHoliday
            ? (escala?.feriadoNome || 'Feriado')
            : isTrabalho && escala?.turno?.includes('-')
              ? escala.turno.split('-')[1]
              : isFds
                ? 'Fim de semana'
                : '';

          return (
            <div key={day} className="relative group h-16 sm:h-20">
              <button
                onClick={() => onDayClick?.(day)}
                disabled={!isInteractive}
                className={`w-full h-full rounded-lg sm:rounded-xl border p-1 sm:p-2 md:p-3 text-left flex flex-col justify-between transition-all overflow-hidden ${bgClass} ${weekendClass} ${pastClass} ${todayClass} ${interactiveClass} ${hasCltAlert ? 'border-error/60 ring-2 ring-error/50' : ''} disabled:cursor-default`}
              >
              <div className="flex items-start justify-between gap-1 w-full">
                <div className={`flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-bold ${isToday && !isTrabalho ? 'text-primary' : textClass}`}>
                  <span className="leading-none">{day}</span>
                  {isToday && <span className="hidden md:inline-block text-[7px] uppercase tracking-widest bg-primary text-on-primary px-1.5 py-0.5 rounded-full shadow-sm">Hoje</span>}
                </div>
                {hasCltAlert && (
                  <span className="text-[8px] sm:text-[10px] font-black text-amber-300 drop-shadow-sm leading-none" title="Alerta CLT: Descanso semanal">!</span>
                )}
                {isFolgaDominicalConfigurada && (
                  <span className={`text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${isTrabalho ? 'bg-white/20 text-white' : 'bg-primary/80 text-on-primary'}`}>
                    Dom
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5 w-full">
                <div className={`text-[8px] sm:text-[10px] font-black tracking-tight sm:tracking-wide flex items-center gap-0.5 sm:gap-1 truncate ${textClass} ${isTrabalho ? 'opacity-100' : 'opacity-70'}`}>
                  {icon && <span className="hidden sm:inline-block material-symbols-outlined text-[10px] sm:text-[12px]">{icon}</span>}
                  <span className="truncate">{primaryLabel}</span>
                </div>

                {secondaryLabel && (
                  <div className={`hidden sm:block text-[9px] font-semibold truncate w-full ${textClass} ${isTrabalho ? 'opacity-90' : 'opacity-60'}`}>{secondaryLabel}</div>
                )}
              </div>
              </button>

              {/* Tooltip Nativo CSS Flutuante */}
              {escala && (
                 <div className="absolute z-50 bottom-full mb-2 hidden group-hover:flex flex-col w-56 p-3 bg-surface-container-highest shadow-2xl rounded-2xl text-sm border border-outline-variant pointer-events-none left-1/2 -translate-x-1/2">
                    <div className="font-bold text-primary mb-1 border-b border-outline-variant/30 pb-1">
                      {String(day).padStart(2, '0')}/{String(month).padStart(2, '0')}/{year}
                    </div>
                    <div className="text-xs text-on-surface mb-1 mt-1">
                      <span className="font-bold">Status:</span> {isHoliday ? 'Feriado' : isFolga ? 'Folga' : isFds ? 'Fim de Semana' : 'Trabalho'}
                    </div>
                    {isTrabalho && escala.turno && (
                      <div className="text-xs text-on-surface mb-1">
                        <span className="font-bold">Turno:</span> {escala.turno}
                      </div>
                    )}
                    {escala.descricao && (
                      <div className="text-xs text-on-surface-variant italic mt-1">
                        "{escala.descricao}"
                      </div>
                    )}
                    {hasCltAlert && (
                      <div className="text-xs text-error font-bold mt-2 flex items-center gap-1 bg-error/10 p-1.5 rounded-lg border border-error/20">
                        <span className="material-symbols-outlined text-[14px]">warning</span>
                        Falta de Descanso Semanal
                      </div>
                    )}
                    <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 border-8 border-transparent border-t-surface-container-highest"></div>
                 </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legenda Atualizada */}
      <div className="mt-5 pt-4 border-t border-outline-variant/10 flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">light_mode</span></span>
          <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Manhã</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">partly_cloudy_day</span></span>
          <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Tarde</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-purple-700 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">dark_mode</span></span>
          <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Noite</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-emerald-600 flex items-center justify-center text-white"><span className="material-symbols-outlined text-[10px]">routine</span></span>
          <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Outro Turno</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-surface-variant/60 bg-[repeating-linear-gradient(-45deg,transparent,transparent_2px,rgba(0,0,0,0.1)_2px,rgba(0,0,0,0.1)_4px)] border border-outline-variant/30"></span>
          <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Folga/FDS</span>
        </div>
        {isInteractive && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-lg">👆</span>
            <span className="text-[9px] text-on-surface-variant font-bold uppercase tracking-wider">Clicável para editar</span>
          </div>
        )}
      </div>
    </div>
  );
}
