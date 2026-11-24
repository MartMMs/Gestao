import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useCompanyConfig } from '../api';
import { useModal } from '../hooks/useModal';
import { ATUALIZACAO, TITULOS, privacidade, termos, type DadosEmpresa, type DocumentoLegal } from '@shared/documentosLegais';

export type { DocumentoLegal };

export function DocumentoLegalModal({ documento, onClose }: { documento: DocumentoLegal; onClose: () => void }) {
  const { data: empresa } = useCompanyConfig();
  const dados: DadosEmpresa = {
    nome: empresa?.nomeEmpresa || 'a empresa',
    contato: [empresa?.emailContato, empresa?.telefoneContato].filter(Boolean).join(' ou ') || 'a recepção',
    endereco: empresa?.endereco || undefined,
  };
  const secoes = documento === 'termos' ? termos(dados) : privacidade(dados);
  const tituloId = useId();
  const cliqueComecouNoFundo = useRef(false);
  // Foco no texto ao abrir: o Tab e o leitor de tela começam no documento, não no link que ficou atrás do modal
  const textoRef = useRef<HTMLElement>(null);
  useEffect(() => { textoRef.current?.focus(); }, [documento]);
  useModal(true, onClose);

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-50 p-4"
      onMouseDown={(event) => { cliqueComecouNoFundo.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (cliqueComecouNoFundo.current && event.target === event.currentTarget) onClose();
        cliqueComecouNoFundo.current = false;
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface-container-lowest rounded-3xl shadow-2xl max-w-2xl w-full border border-outline-variant/20 max-h-[88vh] flex flex-col overflow-hidden"
      >
        {/* Header fixo */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-outline-variant/20 shrink-0 bg-surface-container-low">
          <div>
            <h2 id={tituloId} className="text-xl sm:text-2xl font-headline text-primary">{TITULOS[documento]}</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">{dados.nome} · Última atualização: {ATUALIZACAO}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>

        {/* Body com scroll e padding confortável */}
        <article
          ref={textoRef}
          tabIndex={-1}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-left outline-none text-sm leading-relaxed text-on-surface custom-scrollbar"
        >
          {secoes.map((secao) => (
            <section key={secao.titulo} className="space-y-2">
              <h3 className="font-bold text-primary">{secao.titulo}</h3>
              {secao.texto?.map((p) => <p key={p}>{p}</p>)}
              {secao.itens && <ul className="list-disc space-y-1 pl-5">{secao.itens.map((item) => <li key={item}>{item}</li>)}</ul>}
            </section>
          ))}
        </article>

        {/* Footer fixo */}
        <footer className="flex justify-end px-6 py-4 border-t border-outline-variant/20 shrink-0 bg-surface-container-low">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-wider hover:bg-primary-dim transition-colors"
          >
            Fechar
          </button>
        </footer>
      </motion.div>
    </div>
  );
}

/** Links "Termos de Uso" e "Política de Privacidade" que abrem o texto num modal de leitura. */
export function LinksDocumentosLegais({ className = '', documentos = ['termos', 'privacidade'] }: { className?: string; documentos?: DocumentoLegal[] }) {
  const [aberto, setAberto] = useState<DocumentoLegal | null>(null);
  return (
    <>
      <span className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
        {documentos.map((doc) => (
          <button key={doc} type="button" onClick={() => setAberto(doc)} className="inline-flex items-center min-h-11 underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary rounded">
            {TITULOS[doc]}
          </button>
        ))}
      </span>
      {/* Portal: o link fica dentro de cards animados (transform), que prenderiam o modal "fixed" */}
      {aberto && createPortal(<DocumentoLegalModal documento={aberto} onClose={() => setAberto(null)} />, document.body)}
    </>
  );
}
