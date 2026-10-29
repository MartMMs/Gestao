import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DiaEscala } from '../../../utils/escalaCalculator';

interface PlanningDayPopoverProps {
  isOpen: boolean;
  dia: DiaEscala | null;
  onClose: () => void;
  onSave: (tipo: DiaEscala['tipo'], turno?: string, descricao?: string) => Promise<void>;
}

const TURNO_OPTIONS = [
  { value: '06:00-14:00', label: 'Manhã (06:00 - 14:00)' },
  { value: '14:00-22:00', label: 'Tarde (14:00 - 22:00)' },
  { value: '22:00-06:00', label: 'Noite (22:00 - 06:00)' },
  { value: '08:00-18:00', label: 'Comercial (08:00 - 18:00)' },
  { value: '07:00-19:00', label: 'Integral (07:00 - 19:00)' },
];

export function PlanningDayPopover({ isOpen, dia, onClose, onSave }: PlanningDayPopoverProps) {
  const [selectedType, setSelectedType] = useState<DiaEscala['tipo']>(dia?.tipo || 'trabalho');
  const [selectedTurno, setSelectedTurno] = useState(dia?.turno || '08:00-18:00');
  const [descricao, setDescricao] = useState(dia?.descricao || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !dia) return;
    setSelectedType(dia.tipo);
    setSelectedTurno(dia.turno || '08:00-18:00');
    setDescricao(dia.descricao || '');
    setSaveError(null);
  }, [dia, isOpen]);

  const formattedDate = useMemo(() => {
    if (!dia) return '';
    const [year, month, day] = dia.data.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }, [dia]);

  const isToday = useMemo(() => {
    if (!dia) return false;
    return dia.data === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  }, [dia]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(
        selectedType,
        selectedType === 'trabalho' ? selectedTurno : undefined,
        descricao || undefined
      );
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Falha ao salvar a alteração do dia.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && dia && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 z-40"
          />

          {/* Popover */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm"
          >
            <div className="bg-surface-container p-6 rounded-3xl shadow-2xl border border-outline-variant/20">
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-headline text-on-surface capitalize">
                      {formattedDate}
                    </h3>
                    {isToday && <span className="bg-primary text-on-primary text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full shadow-sm">Hoje</span>}
                  </div>
                  <p className="text-xs text-on-surface-variant uppercase tracking-widest font-bold">
                    Editar Escala
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 hover:bg-surface-container-high rounded-full transition-colors"
                >
                  <span className="material-symbols-outlined text-on-surface-variant">close</span>
                </button>
              </div>

              {/* Type Selection */}
              <div className="mb-4">
                <div className="flex bg-surface-container-low p-1 rounded-xl border border-outline-variant/20 mb-4">
                  {(['trabalho', 'folga', 'fds'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setSelectedType(type);
                        if (type === 'trabalho' && !selectedTurno) {
                          setSelectedTurno('08:00-18:00');
                        }
                      }}
                      className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        selectedType === type
                          ? 'bg-surface-container-highest text-on-surface shadow-sm border border-outline-variant/30'
                          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{type === 'trabalho' ? 'work' : type === 'folga' ? 'event_busy' : 'weekend'}</span>
                      {type === 'trabalho' ? 'Trabalho' : type === 'folga' ? 'Folga' : 'FDS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Turno Selection (only for trabalho) */}
              {selectedType === 'trabalho' && (
                <div className="mb-4">
                  <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">
                    Turno
                  </label>
                  <select
                    value={selectedTurno}
                    onChange={(e) => setSelectedTurno(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-2 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none transition-all"
                  >
                    {TURNO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedType !== 'trabalho' && (
                <div className="mb-4 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-primary">info</span>
                  O turno será removido automaticamente.
                </div>
              )}

              {/* Descrição/Observações */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">
                  Observações (Opcional)
                </label>
                <textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex: Substituindo fulano, turno adicional, etc."
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none transition-all resize-none min-h-[80px]"
                />
              </div>

              {saveError && (
                <div className="mb-4 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                  {saveError}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-outline-variant/30 text-sm font-bold uppercase tracking-wider text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold uppercase tracking-wider bg-primary text-on-primary hover:bg-primary-dim shadow-sm transition-colors disabled:opacity-60"
                >
                  {isSaving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
