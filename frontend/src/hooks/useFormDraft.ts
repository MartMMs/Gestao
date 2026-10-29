import { useCallback, useEffect, useState } from 'react';

// Rascunhos podem conter dados pessoais e de saúde: ficam no sessionStorage (somem ao fechar a aba)
// e são apagados no logout (ver limparRascunhos).
const PREFIXO = 'rascunho:';

export const limparRascunhos = () => {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIXO)).forEach((k) => sessionStorage.removeItem(k));
    localStorage.removeItem('booking-modal-draft'); // formato antigo
  } catch {
    // noop
  }
};

// Há algum formulário com conteúdo guardado? (rascunhos iguais ao estado inicial nem são gravados)
export const existeRascunho = () => {
  try {
    return Object.keys(sessionStorage).some((k) => k.startsWith(PREFIXO));
  } catch {
    return false;
  }
};

export function useFormDraft<T>(key: string, initialValue: T) {
  const [draft, setDraft] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(PREFIXO + key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      // Formulário ainda vazio não deixa rastro no navegador
      if (JSON.stringify(draft) === JSON.stringify(initialValue)) {
        sessionStorage.removeItem(PREFIXO + key);
        return;
      }
      sessionStorage.setItem(PREFIXO + key, JSON.stringify(draft));
    } catch {
      // Ignora falhas de persistencia para nao quebrar o fluxo principal.
    }
  }, [key, draft, initialValue]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(PREFIXO + key);
    } catch {
      // noop
    }
    setDraft(initialValue);
  }, [key, initialValue]);

  return { draft, setDraft, clearDraft };
}
