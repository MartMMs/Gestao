import { useEffect, useRef } from 'react';

/**
 * Contrato dos modais:
 * - cada modal tem UMA função de fechar, usada pelo X, pelo clique fora e pelo Esc (via useModal); um botão escrito
 *   "Cancelar" é a escolha explícita de descartar e fecha direto, sem perguntar;
 * - formulário confirma antes de descartar com `confirmarSaida(alterado)`, onde `alterado` vem de `useAlterado`
 *   (estado do React, não do que está na tela);
 * - foco: ao abrir vai para o primeiro campo do último [role=dialog][aria-modal] (ou o primeiro botão), o Tab fica
 *   preso dentro dele e, ao fechar, volta para quem abriu o modal;
 * - campo que usa o Esc para si (ex.: fechar uma lista de sugestões) chama event.preventDefault() só quando de fato
 *   fechou algo: aí o Esc não fecha o modal.
 */

// Modais abertos, na ordem em que abriram: o Esc fecha só o último e a rolagem volta quando o último fecha
const pilha: Array<{ current: (() => void) | undefined }> = [];
let overflowAnterior = '';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// O modal de cima é o último diálogo modal no DOM (os portais e modais empilhados entram no fim)
const dialogoDoTopo = () => {
  const dialogos = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
  return dialogos[dialogos.length - 1] ?? null;
};
const focaveis = (dialogo: HTMLElement) =>
  Array.from(dialogo.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => el.getClientRects().length > 0);

export const focarPrimeiroCampo = (dialogo: HTMLElement) => {
  const lista = focaveis(dialogo);
  (lista.find((el) => el.matches('input, select, textarea')) ?? lista[0] ?? dialogo).focus();
};

// Tab e Shift+Tab giram dentro do modal de cima
export const prenderTab = (event: KeyboardEvent, dialogo: HTMLElement) => {
  const lista = focaveis(dialogo);
  if (lista.length === 0) { event.preventDefault(); return; }
  const primeiro = lista[0];
  const ultimo = lista[lista.length - 1];
  const ativo = document.activeElement;
  if (event.shiftKey && (ativo === primeiro || !dialogo.contains(ativo))) { event.preventDefault(); ultimo.focus(); }
  else if (!event.shiftKey && (ativo === ultimo || !dialogo.contains(ativo))) { event.preventDefault(); primeiro.focus(); }
};

const aoTeclar = (event: KeyboardEvent) => {
  if (pilha.length === 0) return;
  if (event.key === 'Tab') {
    const dialogo = dialogoDoTopo();
    if (dialogo) prenderTab(event, dialogo);
    return;
  }
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  pilha[pilha.length - 1].current?.();
};

/**
 * Enquanto `aberto`, trava a rolagem da página de fundo e fecha o modal com Esc (chamando `aoFechar`, a mesma
 * função do X). Sem `aoFechar`, o Esc não fecha nada por baixo dele (aviso que exige uma escolha).
 */
export function useModal(aberto: boolean, aoFechar?: () => void) {
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;
  // Quem abriu o modal, lido no render em que ele abre: no effect já seria tarde (um campo com autoFocus já pegou o foco)
  const gatilhoRef = useRef<HTMLElement | null>(null);
  const abertoAntes = useRef(false);
  if (aberto && !abertoAntes.current && typeof document !== 'undefined') gatilhoRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  abertoAntes.current = aberto;

  useEffect(() => {
    if (!aberto) return;
    if (pilha.length === 0) {
      overflowAnterior = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', aoTeclar);
    }
    pilha.push(fecharRef);
    const gatilho = gatilhoRef.current;
    // Espera o modal aparecer no DOM; não rouba o foco de um campo com autoFocus
    const quadro = requestAnimationFrame(() => {
      const dialogo = dialogoDoTopo();
      if (dialogo && !dialogo.contains(document.activeElement)) focarPrimeiroCampo(dialogo);
    });
    return () => {
      cancelAnimationFrame(quadro);
      pilha.splice(pilha.lastIndexOf(fecharRef), 1);
      if (pilha.length === 0) {
        document.body.style.overflow = overflowAnterior;
        window.removeEventListener('keydown', aoTeclar);
      }
      if (gatilho?.isConnected) gatilho.focus();
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
