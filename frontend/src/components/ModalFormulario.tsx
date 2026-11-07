import React, { useId, useRef } from 'react';
import { motion } from 'motion/react';
import { MENSAGEM_SAIDA, useModal } from '../hooks/useModal';

interface ModalFormularioBase {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  submitDisabled?: boolean;
  isSubmitting?: boolean;
  submittingLabel?: string;
  infoBanner?: React.ReactNode;
  alertBanner?: React.ReactNode;
  // Com alterações não salvas, fechar (X ou clique fora) pede confirmação
  hasUnsavedChanges?: boolean;
}

// Formulário exige envio e rótulo do botão; só o modal de leitura (showSubmitButton={false}) dispensa os dois
type ModalFormularioProps = ModalFormularioBase & (
  | { showSubmitButton?: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; submitLabel: string }
  | { showSubmitButton: false; onSubmit?: never; submitLabel?: never }
);

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Tab e Shift+Tab giram dentro do modal: o foco não vai para a tela de trás (no totem, um Enter ali tiraria o cliente do fluxo)
const prenderFoco = (event: React.KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'Tab') return;
  // Só o que está visível (seção recolhida ou input hidden não recebe foco: o Tab pararia nele)
  const focaveis = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.getClientRects().length > 0);
  if (focaveis.length === 0) return;
  event.preventDefault();
  const atual = focaveis.indexOf(document.activeElement as HTMLElement);
  const proximo = event.shiftKey
    ? (atual <= 0 ? focaveis.length - 1 : atual - 1)
    : (atual === -1 || atual === focaveis.length - 1 ? 0 : atual + 1);
  focaveis[proximo].focus();
};

export function ModalFormulario({
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
}: ModalFormularioProps) {
  // Só fecha pelo fundo quando o clique começa E termina nele (arrastar ao selecionar texto não fecha)
  const cliqueComecouNoFundo = useRef(false);
  const tituloId = useId();

  const fecharComConfirmacao = () => {
    // Enquanto salva, fechar esconderia o resultado (e um erro) do usuário
    if (isSubmitting) return;
    if (hasUnsavedChanges && !window.confirm(MENSAGEM_SAIDA)) return;
    onClose();
  };

  // Esc fecha como o X (com a mesma confirmação); o fundo não rola
  useModal(true, fecharComConfirmacao);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        onKeyDown={prenderFoco}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-lg w-full border border-outline-variant/20 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 id={tituloId} className="text-2xl font-headline text-primary">{title}</h2>
          <button onClick={fecharComConfirmacao} disabled={isSubmitting} aria-label="Fechar" className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant disabled:opacity-40" type="button">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {infoBanner}
        {alertBanner}
        <form onSubmit={onSubmit ?? ((event) => event.preventDefault())} className="space-y-4">
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