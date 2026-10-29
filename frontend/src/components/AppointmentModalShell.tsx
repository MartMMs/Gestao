import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';

interface AppointmentModalShellProps {
  title: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
  submitLabel: string;
  submitDisabled?: boolean;
  isSubmitting?: boolean;
  submittingLabel?: string;
  showSubmitButton?: boolean;
  infoBanner?: React.ReactNode;
  alertBanner?: React.ReactNode;
  // Com alterações não salvas, fechar (X ou clique fora) pede confirmação
  hasUnsavedChanges?: boolean;
}

export function AppointmentModalShell({
  title,
  onClose,
  onSubmit,
  children,
  submitLabel,
  submitDisabled = false,
  isSubmitting = false,
  submittingLabel = 'Salvando...',
  showSubmitButton = true,
  infoBanner,
  alertBanner,
  hasUnsavedChanges = false,
}: AppointmentModalShellProps) {
  // Só fecha pelo fundo quando o clique começa E termina nele (arrastar ao selecionar texto não fecha)
  const cliqueComecouNoFundo = useRef(false);

  const fecharComConfirmacao = () => {
    // Enquanto salva, fechar esconderia o resultado (e um erro) do usuário
    if (isSubmitting) return;
    if (hasUnsavedChanges && !window.confirm('Descartar o que você preencheu neste formulário?')) return;
    onClose();
  };

  // Esc fecha como o X (com a mesma confirmação)
  const fecharRef = useRef(fecharComConfirmacao);
  fecharRef.current = fecharComConfirmacao;
  useEffect(() => {
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fecharRef.current();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={(event) => { cliqueComecouNoFundo.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (cliqueComecouNoFundo.current && event.target === event.currentTarget) fecharComConfirmacao();
        cliqueComecouNoFundo.current = false;
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-lg w-full border border-outline-variant/20 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-headline text-primary">{title}</h2>
          <button onClick={fecharComConfirmacao} disabled={isSubmitting} aria-label="Fechar" className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant disabled:opacity-40" type="button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {infoBanner}
        {alertBanner}
        <form onSubmit={onSubmit} className="space-y-4">
          {children}
          {showSubmitButton && (
            <button
              disabled={submitDisabled || isSubmitting}
              type="submit"
              className={`w-full mt-4 bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-all ${(submitDisabled || isSubmitting) ? 'opacity-70 cursor-not-allowed' : 'active:scale-[0.98]'}`}
            >
              {isSubmitting ? submittingLabel : submitLabel}
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}