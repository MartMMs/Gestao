import React from 'react';
import { motion } from 'motion/react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  icon?: string;
  isSubmitting?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  /** Conteúdo extra entre a descrição e os botões (ex.: uma escolha que acompanha a confirmação) */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  confirmingLabel = 'Processando...',
  cancelLabel = 'Cancelar',
  icon = 'warning',
  isSubmitting = false,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-md w-full border border-outline-variant/20 text-center"
      >
        <span className="material-symbols-outlined text-4xl text-error mb-4">{icon}</span>
        <h2 className="text-2xl font-headline text-error mb-2">{title}</h2>
        {description && <p className="text-on-surface-variant text-sm mb-6">{description}</p>}
        {children}
        <div className="flex gap-4">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl font-bold text-sm uppercase text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 py-3 rounded-xl font-bold text-sm uppercase bg-error text-white shadow-sm hover:bg-error/90 transition-colors"
          >
            {isSubmitting ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
