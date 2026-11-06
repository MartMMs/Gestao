import React, { useEffect, useId, useRef } from 'react';
import { motion } from 'motion/react';
import { useModal } from '../hooks/useModal';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  icon?: string;
  /** 'danger' (padrão) para ações destrutivas; 'primary' para confirmações comuns (ex.: remarcar) */
  tone?: 'danger' | 'primary';
  isSubmitting?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  /** Conteúdo extra entre a descrição e os botões (ex.: uma escolha que acompanha a confirmação) */
  children?: React.ReactNode;
}

const TOM = {
  danger: { destaque: 'text-error', botao: 'bg-error text-white hover:bg-error/90' },
  primary: { destaque: 'text-primary', botao: 'bg-primary text-on-primary hover:bg-primary/90' },
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  confirmingLabel = 'Processando...',
  cancelLabel = 'Cancelar',
  icon = 'warning',
  tone = 'danger',
  isSubmitting = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  const tituloId = useId();
  const descricaoId = useId();
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  // Em ref: quem usa costuma passar uma função nova a cada render, e o efeito não deve refazer o foco por isso
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  const enviandoRef = useRef(isSubmitting);
  enviandoRef.current = isSubmitting;

  const caixaRef = useRef<HTMLDivElement>(null);

  // Foco dentro do diálogo ao abrir (teclado e leitor de tela começam nele), preso nele enquanto aberto e
  // devolvido a quem abriu ao fechar. Em ação destrutiva o foco vai para Cancelar: um Enter sem querer não apaga nada.
  useEffect(() => {
    if (!open) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (tone === 'danger' ? cancelarRef : confirmarRef).current?.focus();
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !enviandoRef.current) {
        event.stopPropagation();
        fecharRef.current();
        return;
      }
      if (event.key !== 'Tab' || !caixaRef.current) return;
      const focaveis = [...caixaRef.current.querySelectorAll<HTMLElement>('button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled'));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (event.shiftKey && document.activeElement === primeiro) { event.preventDefault(); ultimo.focus(); }
      else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primeiro.focus(); }
      else if (!caixaRef.current.contains(document.activeElement)) { event.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener('keydown', aoTeclar, true);
    return () => {
      window.removeEventListener('keydown', aoTeclar, true);
      // O elemento de origem pode ter sumido (card movido ou excluído): aí o foco fica onde o navegador puser
      if (anterior?.isConnected) anterior.focus();
    };
  }, [open, tone]);
  // Só a trava de rolagem: o Esc e o foco já são tratados acima
  useModal(open);

  if (!open) return null;
  const estilo = TOM[tone];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={description ? descricaoId : undefined}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-md w-full border border-outline-variant/20 text-center"
      >
        <span className={`material-symbols-outlined text-4xl mb-4 ${estilo.destaque}`} aria-hidden="true">{icon}</span>
        <h2 id={tituloId} className={`text-2xl font-headline mb-2 ${estilo.destaque}`}>{title}</h2>
        {description && <p id={descricaoId} className="text-on-surface-variant text-sm mb-6">{description}</p>}
        {children}
        <div className="flex gap-4">
          <button
            ref={cancelarRef}
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl font-bold text-sm uppercase text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmarRef}
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`flex-1 py-3 rounded-xl font-bold text-sm uppercase shadow-sm transition-colors ${estilo.botao}`}
          >
            {isSubmitting ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
