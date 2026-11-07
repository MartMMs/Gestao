import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCompanyConfig } from '../api';
import { ModalFormulario } from './ModalFormulario';
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
  // Foco no texto ao abrir: o Tab e o leitor de tela começam no documento, não no link que ficou atrás do modal
  const textoRef = useRef<HTMLElement>(null);
  useEffect(() => { textoRef.current?.focus(); }, [documento]);

  return (
    <ModalFormulario title={TITULOS[documento]} onClose={onClose} showSubmitButton={false}>
      <article ref={textoRef} tabIndex={-1} className="space-y-5 text-left outline-none text-sm leading-relaxed text-on-surface">
        <p className="text-xs text-on-surface-variant">{dados.nome} · Última atualização: {ATUALIZACAO}</p>
        {secoes.map((secao) => (
          <section key={secao.titulo} className="space-y-2">
            <h3 className="font-bold text-primary">{secao.titulo}</h3>
            {secao.texto?.map((p) => <p key={p}>{p}</p>)}
            {secao.itens && <ul className="list-disc space-y-1 pl-5">{secao.itens.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
      </article>
    </ModalFormulario>
  );
}

/** Links "Termos de Uso" e "Política de Privacidade" que abrem o texto num modal de leitura. */
export function LinksDocumentosLegais({ className = '', documentos = ['termos', 'privacidade'] }: { className?: string; documentos?: DocumentoLegal[] }) {
  const [aberto, setAberto] = useState<DocumentoLegal | null>(null);
  return (
    <>
      <span className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
        {documentos.map((doc) => (
          <button key={doc} type="button" onClick={() => setAberto(doc)} className="underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary rounded">
            {TITULOS[doc]}
          </button>
        ))}
      </span>
      {/* Portal: o link fica dentro de cards animados (transform), que prenderiam o modal "fixed" */}
      {aberto && createPortal(<DocumentoLegalModal documento={aberto} onClose={() => setAberto(null)} />, document.body)}
    </>
  );
}
