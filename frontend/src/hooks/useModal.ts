import { useEffect, useRef } from 'react';

/**
 * Contrato dos modais:
 * - cada modal tem UMA função de fechar, usada pelo X, pelo clique fora e pelo Esc (via useModal); um botão escrito
 *   "Cancelar" é a escolha explícita de descartar e fecha direto, sem perguntar;
 * - formulário confirma antes de descartar com `confirmarSaida(alterado)`, onde `alterado` vem de `useAlterado`
 *   (estado do React, não do que está na tela);
 * - campo que usa o Esc para si (ex.: fechar uma lista de sugestões) chama event.preventDefault() só quando de fato
 *   fechou algo: aí o Esc não fecha o modal.
 */

// Modais abertos, na ordem em que abriram: o Esc fecha só o último e a rolagem volta quando o último fecha
const pilha: Array<{ current: (() => void) | undefined }> = [];
let overflowAnterior = '';

const aoTeclar = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || pilha.length === 0) return;
  pilha[pilha.length - 1].current?.();
};

/**
 * Enquanto `aberto`, trava a rolagem da página de fundo e fecha o modal com Esc (chamando `aoFechar`, a mesma
 * função do X). Sem `aoFechar`, o Esc não fecha nada por baixo dele (aviso que exige uma escolha).
 */
export function useModal(aberto: boolean, aoFechar?: () => void) {
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  useEffect(() => {
    if (!aberto) return;
    if (pilha.length === 0) {
      overflowAnterior = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', aoTeclar);
    }
    pilha.push(fecharRef);
    return () => {
      pilha.splice(pilha.lastIndexOf(fecharRef), 1);
      if (pilha.length === 0) {
        document.body.style.overflow = overflowAnterior;
        window.removeEventListener('keydown', aoTeclar);
      }
    };
  }, [aberto]);
}

/**
 * Se os `valores` do formulário mudaram desde que o modal abriu. Os valores do primeiro render aberto são a
 * referência: quem abre o modal já deixa o estado pronto no mesmo clique (um digitar-e-apagar volta a "não mudou").
 */
export function useAlterado(aberto: boolean, valores: unknown) {
  const atual = JSON.stringify(valores);
  const inicial = useRef<string | null>(null);
  if (!aberto) inicial.current = null;
  else if (inicial.current === null) inicial.current = atual;
  return aberto && inicial.current !== atual;
}

export const MENSAGEM_SAIDA = 'Você quer mesmo sair? O que foi preenchido não será salvo.';

// Só pergunta quando há algo a perder
export const confirmarSaida = (alterado: boolean) => !alterado || window.confirm(MENSAGEM_SAIDA);
