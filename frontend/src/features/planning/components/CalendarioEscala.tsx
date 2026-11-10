import React, { useEffect, useMemo, useState } from 'react';
import { DiaEscala } from '../../../utils/escalaCalculator';
import { CARGA_SEMANAL_MAXIMA_HORAS } from '../../../utils/cltValidator';
import { LEGENDA_CATEGORIAS, VISUAL_CATEGORIA, analisarMes, formatarHoras, turnoDoDia, visualDoDia } from '../utils/turnos';

export interface CalendarioEscalaProps {
  /** Dias do colaborador; pode trazer dias dos meses vizinhos, usados só nas regras da CLT (virada do mês) */
  escalas: DiaEscala[];
  year: number;
  month: number; // 1-12
  hoje: string; // AAAA-MM-DD no fuso do negócio
  dayRange?: { start: number; end: number };
  cargaHorariaSemanal?: number;
  tipoEscala?: string;
  colaboradorNome?: string;
  colaboradorCargo?: string;
  /** "editar": clique abre o dia, arrastar (ou Shift+clique) seleciona vários. "trocar": troca dois dias */
  modo: 'editar' | 'trocar';
  onDayClick?: (dia: DiaEscala) => void;
  onRangeSelect?: (dias: DiaEscala[]) => void;
  onDayDrop?: (from: number, to: number) => void;
  /** Datas (AAAA-MM-DD) com proposta ainda não gravada: aparecem tracejadas */
  propostos?: Set<string>;
}

const DAY_HEADERS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function LegendaTurnos() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {LEGENDA_CATEGORIAS.map((categoria) => (
        <span key={categoria} className="flex items-center gap-1.5 text-[11px] text-on-surface-variant font-medium">
          <span className={`w-2 h-2 rounded-full ${VISUAL_CATEGORIA[categoria].cor}`} />
          {categoria === 'folga' ? 'Folga / FDS' : VISUAL_CATEGORIA[categoria].rotulo}
        </span>
      ))}
    </div>
  );
}

export function CalendarioEscala({
  escalas,
  year,
  month,
  hoje,
  dayRange,
  cargaHorariaSemanal = 44,
  tipoEscala,
  colaboradorNome,
  colaboradorCargo,
  modo,
  onDayClick,
  onRangeSelect,
  onDayDrop,
  propostos,
}: CalendarioEscalaProps) {
  const prefixoMes = `${year}-${String(month).padStart(2, '0')}-`;
  // Seleção de vários dias (modo editar) e dia de origem da troca (modo trocar)
  const [arrasto, setArrasto] = useState<{ inicio: number; atual: number } | null>(null);
  const [ancora, setAncora] = useState<number | null>(null);
  const [origemTroca, setOrigemTroca] = useState<number | null>(null);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    setArrasto(null);
    setAncora(null);
    setOrigemTroca(null);
  }, [modo, year, month]);

  const { daysInMonth, firstVisibleDayOffset, visibleDays, mapByDay } = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    const map = new Map<number, DiaEscala>();
    const rangeStart = Math.max(1, dayRange?.start ?? 1);
    const rangeEnd = Math.min(days, dayRange?.end ?? days);
    const visible = rangeEnd >= rangeStart ? Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i) : [];
    escalas.forEach((item) => {
      if (item.data.startsWith(prefixoMes)) map.set(Number(item.data.slice(8, 10)), item);
    });
    return {
      daysInMonth: days,
      firstVisibleDayOffset: visible.length > 0 ? new Date(year, month - 1, visible[0]).getDay() : 0,
      visibleDays: visible,
      mapByDay: map,
    };
  }, [dayRange?.end, dayRange?.start, escalas, month, prefixoMes, year]);

  // Regras da CLT pelas funções compartilhadas com o backend (as mesmas do alerta oficial e do painel lateral)
  const clt = useMemo(() => analisarMes(escalas, prefixoMes, tipoEscala), [escalas, prefixoMes, tipoEscala]);

  const selecao = useMemo(() => {
    if (!arrasto) return new Set<number>();
    const min = Math.min(arrasto.inicio, arrasto.atual);
    const max = Math.max(arrasto.inicio, arrasto.atual);
    return new Set(Array.from({ length: max - min + 1 }, (_, i) => min + i));
  }, [arrasto]);

  // Esc cancela a troca com o foco em qualquer lugar (no Safari o clique não foca o botão do dia)
  useEffect(() => {
    if (origemTroca === null) return;
    const cancelar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOrigemTroca(null);
      setAviso('Troca cancelada.');
    };
    window.addEventListener('keydown', cancelar);
    return () => window.removeEventListener('keydown', cancelar);
  }, [origemTroca]);

  // Soltar fora do calendário cancela (antes abria o lote com o que estivesse marcado)
  useEffect(() => {
    if (!arrasto) return;
    const cancelar = () => setArrasto(null);
    window.addEventListener('pointerup', cancelar);
    return () => window.removeEventListener('pointerup', cancelar);
  }, [arrasto]);

  const editavel = (day: number) => {
    const dia = mapByDay.get(day);
    return Boolean(dia && dia.data >= hoje);
  };

  const abrirIntervalo = (de: number, ate: number) => {
    const min = Math.min(de, ate);
    const max = Math.max(de, ate);
    const dias: DiaEscala[] = [];
    for (let d = min; d <= max; d += 1) if (editavel(d)) dias.push(mapByDay.get(d)!);
    if (dias.length > 1) onRangeSelect?.(dias);
    else if (dias.length === 1) onDayClick?.(dias[0]);
  };

  const ativarDia = (day: number, estender: boolean) => {
    if (!editavel(day)) return;
    if (modo === 'trocar') {
      if (origemTroca === null) {
        setOrigemTroca(day);
        setAviso(`Dia ${day} escolhido. Toque no dia para trocar com ele. Para cancelar, toque de novo no dia ${day} ou aperte Esc.`);
      } else {
        if (origemTroca !== day) onDayDrop?.(origemTroca, day);
        setOrigemTroca(null);
        setAviso('');
      }
      return;
    }
    if (estender && ancora !== null) abrirIntervalo(ancora, day);
    else {
      setAncora(day);
      onDayClick?.(mapByDay.get(day)!);
    }
  };

  return (
    <div className="bg-surface-container-lowest p-4 sm:p-6 rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden select-none">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 mb-5 border-b border-outline-variant/15">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[20px] text-primary w-9 h-9 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center justify-center shrink-0">calendar_month</span>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-base font-semibold tracking-tight text-on-surface">Calendário de Escalas</h3>
              {colaboradorNome && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-md bg-surface-container text-on-surface-variant border border-outline-variant/20">
                  {colaboradorNome}
                  {colaboradorCargo ? <span className="text-on-surface-variant/70">• {colaboradorCargo}</span> : null}
                </span>
              )}
              {modo === 'trocar' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25">
                  <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                  Trocar dias
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {modo === 'trocar'
                ? 'Arraste um dia sobre outro, ou toque em dois dias, para trocá-los.'
                : 'Toque num dia para editar. Para vários dias, arraste com o mouse ou use Shift + clique.'}
            </p>
          </div>
        </div>

        {/* Horas pelas mesmas contas do alerta CLT (horas do turno; limite semanal da lei) */}
        <div className={`flex flex-col gap-1 min-w-0 sm:min-w-[280px] p-3 rounded-xl border ${clt.carga.conforme ? 'bg-surface-container-low/70 border-outline-variant/20' : 'bg-error/5 border-error/30'}`}>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-on-surface-variant flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
              {formatarHoras(clt.horasMes)} no mês
            </span>
            <span className={`font-semibold tabular-nums ${clt.carga.conforme ? 'text-on-surface' : 'text-error'}`}>
              {tipoEscala === '12x36' ? 'Média' : 'Maior semana'}: {formatarHoras(clt.carga.cargaTotal)} (limite CLT {CARGA_SEMANAL_MAXIMA_HORAS}h)
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
            <span>{clt.diasTrabalhados} dias de trabalho • {clt.diasDescanso} de descanso</span>
            <span>Contrato: {cargaHorariaSemanal}h/sem</span>
          </div>
          {clt.diasSemTurno > 0 && (
            <p className="text-[11px] text-on-surface-variant">
              {clt.diasSemTurno} dia(s) de trabalho sem turno definido não entram nas horas.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center mb-2" aria-hidden="true">
        {DAY_HEADERS.map((day) => (
          <span key={day} className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider py-1.5">
            <span className="hidden sm:inline">{day}</span>
            <span className="sm:hidden">{day.charAt(0)}</span>
          </span>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-1.5 sm:gap-2"
        onPointerUp={() => {
          // Soltar no vão entre dois dias conta como soltar no último dia alcançado
          if (!arrasto) return;
          setArrasto(null);
          if (arrasto.inicio !== arrasto.atual) {
            setAncora(arrasto.inicio);
            abrirIntervalo(arrasto.inicio, arrasto.atual);
          }
        }}
      >
        {Array.from({ length: firstVisibleDayOffset }).map((_, index) => (
          <div key={`empty-${index}`} className="h-20 sm:h-24 rounded-xl bg-surface-container-low/20 border border-outline-variant/10" />
        ))}

        {visibleDays.map((day) => {
          const escala = mapByDay.get(day);
          const turno = turnoDoDia(escala);
          const visual = visualDoDia(escala);
          const isTrabalho = escala?.tipo === 'trabalho';
          const interjornada = clt.interjornada.get(day);
          const temDsr = clt.setimoDia.has(day);
          const dataDia = `${prefixoMes}${String(day).padStart(2, '0')}`;
          const isToday = dataDia === hoje;
          const isPast = dataDia < hoje;
          const podeEditar = editavel(day);
          const selecionado = selecao.has(day) || origemTroca === day;
          const proposto = propostos?.has(dataDia) ?? false;
          const alertas = [
            interjornada !== undefined ? `descanso de ${formatarHoras(interjornada)} entre jornadas (mínimo 11h)` : '',
            temDsr ? '7º dia seguido sem folga' : '',
          ].filter(Boolean);
          const descricao = [
            `${day} de ${new Date(year, month - 1, day).toLocaleDateString('pt-BR', { month: 'long' })}`,
            isTrabalho ? `${visual.rotulo}, ${turno ? turno.replace('-', ' às ') : 'sem turno definido'}` : visual.rotulo,
            escala?.feriadoNome,
            escala?.descricao,
            ...alertas.map((a) => `Alerta: ${a}`),
            proposto ? 'Proposta ainda não gravada' : '',
            isPast ? 'dia passado, não pode ser alterado' : '',
          ].filter(Boolean).join('. ');

          return (
            <button
              key={day}
              type="button"
              disabled={!podeEditar}
              aria-label={descricao}
              aria-pressed={modo === 'trocar' ? origemTroca === day : undefined}
              title={descricao}
              draggable={modo === 'trocar' && podeEditar}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(day));
                setOrigemTroca(day);
              }}
              onDragEnd={() => setOrigemTroca(null)}
              onDragOver={(e) => { if (modo === 'trocar' && podeEditar) e.preventDefault(); }}
              onDrop={(e) => {
                e.preventDefault();
                const de = Number(e.dataTransfer.getData('text/plain'));
                if (de && de !== day) onDayDrop?.(de, day);
                setOrigemTroca(null);
              }}
              onPointerDown={(e) => {
                if (modo !== 'editar' || e.pointerType !== 'mouse' || e.button !== 0 || e.shiftKey) return;
                setArrasto({ inicio: day, atual: day });
              }}
              onPointerEnter={(e) => {
                if (!arrasto) return;
                // Botão solto fora da janela: a seleção não pode continuar sozinha
                if ((e.buttons & 1) === 0) setArrasto(null);
                else if (podeEditar) setArrasto({ ...arrasto, atual: day });
              }}
              onPointerUp={(e) => {
                if (!arrasto) return;
                e.stopPropagation();
                const { inicio, atual } = arrasto;
                setArrasto(null);
                if (inicio !== atual) {
                  setAncora(inicio);
                  abrirIntervalo(inicio, atual);
                }
              }}
              onClick={(e) => {
                // O fim de um arrasto entre dias já abriu o lote no pointerup
                if (arrasto === null || arrasto.inicio === arrasto.atual) ativarDia(day, e.shiftKey);
              }}
              className={`relative h-20 sm:h-24 rounded-xl border border-outline-variant/20 border-l-[3px] ${visual.barra} ${isTrabalho ? visual.fundo : 'bg-surface-container-lowest'} p-1.5 sm:p-2.5 text-left flex flex-col justify-between overflow-hidden transition-all duration-150 ${
                podeEditar ? (modo === 'trocar' ? 'cursor-grab active:cursor-grabbing hover:brightness-95' : 'cursor-pointer hover:brightness-95') : 'cursor-default opacity-60'
              } ${isToday ? 'ring-1 ring-primary' : ''} ${selecionado ? 'ring-2 ring-primary' : ''} ${origemTroca === day ? '!bg-primary/25' : ''} ${proposto ? 'border-dashed border-primary' : ''} ${alertas.length > 0 ? 'outline outline-1 outline-amber-500/70' : ''} focus-visible:ring-2 focus-visible:ring-primary`}
            >
              <div className="flex items-center justify-between gap-1 w-full">
                <span className={`text-xs sm:text-sm font-semibold tabular-nums leading-none ${isToday ? 'text-primary font-bold' : 'text-on-surface'}`}>
                  {String(day).padStart(2, '0')}
                </span>
                <span className="flex items-center gap-1">
                  {alertas.length > 0 && (
                    <span className="material-symbols-outlined text-[14px] text-amber-600 dark:text-amber-400" aria-hidden="true">warning</span>
                  )}
                  {escala?.folgaDominicalConfigurada && (
                    <span className="hidden sm:inline text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-surface-container text-on-surface-variant border border-outline-variant/20">Dom</span>
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-0.5 w-full min-w-0" aria-hidden="true">
                {/* Trabalho mostra o horário (o período já está na cor e no ícone); folga mostra o tipo */}
                <span className={`flex items-center gap-1 min-w-0 ${visual.texto}`}>
                  <span className="material-symbols-outlined text-[14px] shrink-0">{visual.icone}</span>
                  {!isTrabalho && <span className="hidden sm:inline text-[11px] font-semibold truncate">{visual.rotulo}</span>}
                  {proposto && <span className="hidden sm:inline text-[9px] font-bold uppercase text-primary">Proposta</span>}
                </span>
                {isTrabalho && turno && (
                  <span className="text-[10px] text-on-surface tabular-nums truncate">
                    <span className="sm:hidden">{turno.slice(0, 2)}h</span>
                    <span className="hidden sm:inline">{turno.replace('-', '–')}</span>
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Visível também: no celular é o único sinal de que o primeiro toque pegou */}
      <p aria-live="polite" className={origemTroca !== null ? 'mt-3 text-xs font-semibold text-primary' : 'sr-only'}>{aviso}</p>

      <div className="mt-5 pt-4 border-t border-outline-variant/15">
        <LegendaTurnos />
      </div>
    </div>
  );
}
