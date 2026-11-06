import React from 'react';
import { motion } from 'motion/react';
import { useModal } from '../hooks/useModal';

export interface CltAlert {
  id: string;
  nome: string;
  conforme: boolean;
  resumo: string[];
}

interface AuditorModalProps {
  open: boolean;
  alerts: CltAlert[];
  onClose: () => void;
  onResolve?: (employeeId: string) => void;
}

export function AuditorModal({ open, alerts, onClose, onResolve }: AuditorModalProps) {
  useModal(open, onClose);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Alertas do auditor"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-surface-container-lowest p-6 rounded-3xl shadow-2xl border border-outline-variant/20 w-full max-w-lg flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-outline-variant/20">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${alerts.length > 0 ? 'bg-error/10 text-error' : 'bg-emerald-500/10 text-emerald-600'}`}>
              <span className="material-symbols-outlined">{alerts.length > 0 ? 'warning' : 'verified_user'}</span>
            </div>
            <div>
              <h2 className="text-xl font-headline text-on-surface">Auditoria CLT</h2>
              <p className="text-xs text-on-surface-variant uppercase tracking-widest font-bold mt-0.5">Monitoramento Contínuo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 pr-2">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <span className="material-symbols-outlined text-6xl text-emerald-500/50 mb-4">check_circle</span>
              <h3 className="text-lg font-headline text-emerald-600 mb-2">Escala em Conformidade</h3>
              <p className="text-sm text-on-surface-variant max-w-xs">Nenhuma infração trabalhista detectada. Sua equipe está operando dentro dos limites legais.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {alerts.map(alerta => (
                <div key={alerta.id} className="bg-error/5 border border-error/20 rounded-2xl p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-sm font-bold text-on-surface">{alerta.nome}</h4>
                    <span className="bg-error text-white text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md shadow-sm">Urgente</span>
                  </div>
                  <ul className="space-y-2 mt-3">
                    {alerta.resumo.map((msg, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-error/90 leading-relaxed">
                        <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">emergency_home</span>
                        {msg}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 pt-3 border-t border-error/10 flex justify-end">
                    <button
                      onClick={() => onResolve ? onResolve(alerta.id) : onClose()}
                      className="text-xs font-bold text-error uppercase tracking-widest hover:text-error/70 transition-colors flex items-center gap-1"
                    >
                      Resolver na Escala <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-outline-variant/20 flex justify-between items-center">
          <span className="text-[11px] text-on-surface-variant uppercase tracking-widest">Motor de validação ativo</span>
          <button onClick={onClose} className="px-5 py-2.5 bg-surface-container hover:bg-surface-container-high rounded-xl text-xs font-bold text-on-surface uppercase tracking-wider transition-colors">
            Fechar
          </button>
        </div>
      </motion.div>
    </div>
  );
}