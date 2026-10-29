import { useCallback, useEffect, useState } from 'react';

export const TOAST_DURATION_MS = 3500;

/**
 * Mensagem passageira com um único timer. Cada chamada (inclusive com o mesmo texto) reinicia a contagem,
 * então uma mensagem nova nunca é apagada pelo timer da anterior. setToastMessage é estável entre renders.
 */
export function useToast(durationMs = TOAST_DURATION_MS) {
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);

  const setToastMessage = useCallback((message: string | null) => {
    setToast(message ? { message, id: Date.now() + Math.random() } : null);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);

  return { toastMessage: toast?.message ?? null, setToastMessage };
}
