import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from './ConfirmDialog';
import { MENSAGEM_SAIDA, registrarConfirmacaoSaida } from '../hooks/useModal';

/** Janela padrão "Descartar alterações?" de todos os formulários (ver confirmarSaida em hooks/useModal). */
export function ConfirmacaoSaidaHost() {
  const [seguir, setSeguir] = useState<(() => void) | null>(null);
  useEffect(() => {
    registrarConfirmacaoSaida((fn) => setSeguir(() => fn));
    return () => registrarConfirmacaoSaida(null);
  }, []);
  // Acima de qualquer modal aberto (o formulário que pediu a confirmação continua por baixo)
  return createPortal(
    <div className="relative z-[200]">
      <ConfirmDialog
        open={Boolean(seguir)}
        title="Descartar alterações?"
        description={MENSAGEM_SAIDA}
        confirmLabel="Descartar e fechar"
        cancelLabel="Continuar editando"
        onClose={() => setSeguir(null)}
        onConfirm={() => { const fn = seguir; setSeguir(null); fn?.(); }}
      />
    </div>,
    document.body,
  );
}
