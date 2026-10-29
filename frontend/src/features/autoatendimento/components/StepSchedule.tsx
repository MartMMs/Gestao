import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Service, AutoatendimentoSlot, AutoatendimentoReservaSession } from '../../../types';
import {
  fetchAutoatendimentoDisponibilidade,
  reservarSlotAutoatendimento,
} from '../services/autoatendimentoService';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { mensagemDeErro } from '../utils/erros';

interface StepScheduleProps {
  services?: Service[];
  service?: Service;
  onSlotReserved: (session: {
    sessionToken: string;
    lockExpiresAt: number;
    detalhes: AutoatendimentoReservaSession;
  }) => void;
  onBack: () => void;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function StepSchedule({ services, service, onSlotReserved, onBack }: StepScheduleProps) {
  const activeServices = React.useMemo(() => {
    if (services && services.length > 0) return services;
    if (service) return [service];
    return [];
  }, [services, service]);

  const totalDuration = React.useMemo(() => {
    return activeServices.reduce((sum, s) => sum + (s.duracao || 60), 0);
  }, [activeServices]);

  const serviceNames = React.useMemo(() => {
    return activeServices.map((s) => s.nome).join(' + ') || 'Atendimento Personalizado';
  }, [activeServices]);

  // "Hoje" no fuso de Brasília (toISOString usaria UTC e pularia para amanhã depois das 21h)
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalTodayString());
  const [slots, setSlots] = useState<AutoatendimentoSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AutoatendimentoSlot | null>(null);
  const [isLocking, setIsLocking] = useState(false);

  // Gera os próximos 14 dias para o seletor visual
  const availableDates = React.useMemo(() => {
    const list: Array<{ dateStr: string; day: number; weekday: string; month: string; isToday: boolean }> = [];
    const [ano, mes, dia] = getLocalTodayString().split('-').map(Number);
    for (let i = 0; i < 14; i++) {
      // Meio-dia local evita qualquer virada de dia por fuso/horário de verão
      const d = new Date(ano, mes - 1, dia + i, 12);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      list.push({
        dateStr,
        day: d.getDate(),
        weekday: WEEKDAYS[d.getDay()],
        month: MONTHS[d.getMonth()],
        isToday: i === 0,
      });
    }
    return list;
  }, []);

  const loadDisponibilidade = async (dateStr: string) => {
    if (activeServices.length === 0) return;
    setLoading(true);
    setError(null);
    setSelectedSlot(null);
    try {
      const ids = activeServices.map((s) => s.id);
      const res = await fetchAutoatendimentoDisponibilidade(ids, dateStr);
      setSlots(res.slots || []);
    } catch (err: unknown) {
      setError(mensagemDeErro(err, 'Falha ao carregar horários disponíveis.'));
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDisponibilidade(selectedDate);
  }, [selectedDate, activeServices]);

  // Trava síncrona: o estado isLocking só muda no próximo render, e dois toques rápidos criariam duas reservas
  const reservandoRef = useRef(false);

  const handleReserve = async () => {
    if (reservandoRef.current || !selectedSlot || !selectedSlot.disponivel || activeServices.length === 0) return;
    reservandoRef.current = true;
    setIsLocking(true);
    setError(null);

    try {
      const ids = activeServices.map((s) => s.id);
      const result = await reservarSlotAutoatendimento({
        servicoIds: ids,
        servicoId: ids[0],
        data: selectedDate,
        horario: selectedSlot.horario,
        terapeutaId: selectedSlot.terapeuta?.id,
        salaId: selectedSlot.sala?.id,
      });

      onSlotReserved({
        sessionToken: result.sessionToken,
        lockExpiresAt: result.lockExpiresAt,
        detalhes: result.detalhes,
      });
    } catch (err: unknown) {
      setError(mensagemDeErro(err, 'Não foi possível reservar este horário. Atualizando disponibilidade...'));
      // Recarrega os slots para refletir a ocupação atualizada
      loadDisponibilidade(selectedDate);
    } finally {
      reservandoRef.current = false;
      setIsLocking(false);
    }
  };

  // Separação em turnos
  const { manhaSlots, tardeSlots, noiteSlots } = React.useMemo(() => {
    const manha: AutoatendimentoSlot[] = [];
    const tarde: AutoatendimentoSlot[] = [];
    const noite: AutoatendimentoSlot[] = [];

    slots.forEach((s) => {
      const [h] = s.horario.split(':').map(Number);
      if (h < 12) manha.push(s);
      else if (h < 18) tarde.push(s);
      else noite.push(s);
    });

    return { manhaSlots: manha, tardeSlots: tarde, noiteSlots: noite };
  }, [slots]);

  const renderSlotGroup = (title: string, icon: string, items: AutoatendimentoSlot[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5 text-xs font-bold uppercase tracking-wider text-on-surface-variant pb-1">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <span className="material-symbols-outlined text-[17px]">{icon}</span>
          </div>
          <span>{title}</span>
          <span className="text-[10px] text-on-surface-variant/70 font-normal">
            ({items.filter((i) => i.disponivel).length} vagas livres)
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {items.map((slot) => {
            const isSelected = selectedSlot?.horario === slot.horario;
            return (
              <button
                key={slot.horario}
                type="button"
                disabled={!slot.disponivel}
                onClick={() => setSelectedSlot(slot)}
                className={`p-3 rounded-xl border text-left transition-all relative ${
                  !slot.disponivel
                    ? 'bg-surface-container-low/50 border-outline-variant/15 opacity-40 cursor-not-allowed'
                    : isSelected
                    ? 'bg-primary text-on-primary border-primary shadow-md ring-2 ring-primary/30'
                    : 'bg-surface-container-lowest border-outline-variant/25 hover:border-primary/50 text-on-surface'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold">{slot.horario}</span>
                  {slot.disponivel ? (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSelected ? 'bg-on-primary' : 'bg-emerald-500'
                      }`}
                    />
                  ) : (
                    <span className="material-symbols-outlined text-[14px] text-outline-variant">
                      lock
                    </span>
                  )}
                </div>

                {slot.disponivel && slot.sala && (
                  <p
                    className={`text-[10px] truncate ${
                      isSelected ? 'text-on-primary/90' : 'text-on-surface-variant'
                    }`}
                  >
                    {slot.sala.nome.split('-')[0]}
                  </p>
                )}
                {slot.disponivel && slot.terapeuta && (
                  <p
                    className={`text-[10px] truncate ${
                      isSelected ? 'text-on-primary/80' : 'text-on-surface-variant/80'
                    }`}
                  >
                    {slot.terapeuta.nome.split(' ')[0]}
                  </p>
                )}
                {!slot.disponivel && (
                  <p className="text-[9px] text-error/80 truncate">Ocupado</p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-primary bg-primary/10 px-3 py-1 rounded-full">
          Etapa 2 de 4 · Selecione Dia e Horário
        </span>
        <h2 className="text-2xl sm:text-3xl font-headline text-primary">
          Disponibilidade em Tempo Real
        </h2>
        <p className="text-sm text-on-surface-variant font-body">
          {serviceNames} · <strong>{totalDuration} min de atendimento</strong> (sessão contínua com higienização inclusa)
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Carrossel de Datas */}
      <div className="space-y-2">
        <label className="block text-[11px] font-bold tracking-wider uppercase text-on-surface-variant">
          Datas Disponíveis
        </label>
        <div className="flex gap-3 overflow-x-auto pb-3 pt-1 px-1 custom-scrollbar">
          {availableDates.map((item) => {
            const isSelected = selectedDate === item.dateStr;
            return (
              <button
                key={item.dateStr}
                type="button"
                data-date={item.dateStr}
                onClick={() => setSelectedDate(item.dateStr)}
                className={`min-w-[76px] p-3.5 rounded-2xl border text-center transition-all shrink-0 cursor-pointer shadow-xs ${
                  isSelected
                    ? 'bg-primary text-on-primary border-primary shadow-md scale-102 ring-2 ring-primary/30'
                    : 'bg-surface-container-lowest border-outline-variant/25 text-on-surface hover:border-primary/40'
                }`}
              >
                <span className="block text-[10px] uppercase font-bold tracking-wider mb-0.5 opacity-80">
                  {item.isToday ? 'Hoje' : item.weekday}
                </span>
                <span className="block text-lg font-bold font-headline">{item.day}</span>
                <span className="block text-[10px] opacity-75">{item.month}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid de Horários */}
      <div className="bg-surface-container-lowest border border-outline-variant/25 rounded-2xl p-5 shadow-sm min-h-[280px]">
        {loading ? (
          <div className="h-48 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl animate-spin text-primary">
              progress_activity
            </span>
            <p className="text-xs">Consultando profissionais e salas disponíveis...</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2 text-on-surface-variant text-center">
            <span className="material-symbols-outlined text-3xl text-outline-variant">
              event_busy
            </span>
            <p className="text-sm font-bold text-on-surface">Nenhum horário livre nesta data.</p>
            <p className="text-xs text-on-surface-variant">
              Por favor, selecione outro dia no calendário acima.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {renderSlotGroup('Manhã', 'wb_sunny', manhaSlots)}
            {renderSlotGroup('Tarde', 'sunny', tardeSlots)}
            {renderSlotGroup('Noite', 'bedtime', noiteSlots)}
          </div>
        )}
      </div>

      {/* Resumo e Ação de Lock de 10 min */}
      <div className="pt-4 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-outline-variant/30 text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Voltar para o Catálogo de Produtos</span>
        </button>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          {selectedSlot && (
            <div className="text-xs text-right hidden sm:block">
              <span className="text-on-surface-variant block">
                {selectedDate} às <strong className="text-primary">{selectedSlot.horario}</strong>
              </span>
              <span className="text-[10px] text-outline-variant">
                {selectedSlot.sala?.nome} · {selectedSlot.terapeuta?.nome}
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={!selectedSlot || isLocking}
            onClick={handleReserve}
            className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-xs uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-all shadow-sm ${
              selectedSlot && !isLocking
                ? 'bg-primary text-on-primary hover:bg-primary-dim active:scale-[0.98]'
                : 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed opacity-60'
            }`}
          >
            {isLocking ? (
              <>
                <span className="material-symbols-outlined text-[18px] animate-spin">
                  progress_activity
                </span>
                <span>Travando Horário...</span>
              </>
            ) : (
              <>
                <span>Garantir Reserva (10 min)</span>
                <span className="material-symbols-outlined text-[18px]">lock_clock</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
