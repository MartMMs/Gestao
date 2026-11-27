import { useId } from 'react';
import { useModal } from '../hooks/useModal';
import { parseClientObservation } from '../utils/anamneseUtils';
import { FichaFormulario } from './FichaFormulario';

interface Props {
  nome: string;
  // Observação do cliente como a API mandou (vem null para quem não pode ver dados de saúde)
  observacao?: string | null;
  // Há ficha, mas a API não mandou o conteúdo (LGPD: só a supervisão e o profissional do atendimento veem)
  restrita?: boolean;
  exigirAnamnese?: boolean;
  // Sem onEditar, o modal só mostra a ficha
  onEditar?: () => void;
  onClose: () => void;
  // Cliente cadastrado e quem abriu vê a saúde dele: mostra o formulário configurável e o histórico de fichas
  clienteId?: string | null;
  podeEditarFormulario?: boolean;
}

// Visualização da ficha de anamnese (lista de clientes e agendamento); editar abre a ficha nova de quem chamou
export function FichaAnamneseModal({ nome, observacao, restrita = false, exigirAnamnese, onEditar, onClose, clienteId, podeEditarFormulario = false }: Props) {
  useModal(true, onClose);
  const tituloId = useId();
  const itens = parseClientObservation(observacao).anamSummary;
  // Quem vê a saúde de um cliente cadastrado edita só pelo formulário configurável
  const formularioNovo = Boolean(clienteId) && !restrita;

  // Clique fora fecha, mas não o 2º clique de um duplo clique no nome que abriu o modal (cai no fundo)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && e.detail < 2) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar border border-outline-variant/20">
        <div className="flex justify-between items-center mb-4">
          <h2 id={tituloId} className="text-2xl font-headline text-primary">Resumo da Ficha de Anamnese</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <p className="text-sm text-on-surface-variant mb-4">
          Cliente: <strong className="text-on-surface">{nome}</strong>
        </p>
        {restrita ? (
          <p className="text-sm text-on-surface-variant bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2">
            Este cliente já tem ficha registrada. O conteúdo é visível só para a supervisão e para o profissional do atendimento.
          </p>
        ) : formularioNovo ? (
          <>
            {/* A ficha antiga fica só para consulta: a edição da equipe é pelo formulário abaixo (sem perguntas repetidas) */}
            {itens.length > 0 && (
              <details className="rounded-xl border border-outline-variant/20 p-3">
                <summary className="text-xs font-bold text-on-surface-variant cursor-pointer min-h-11 flex items-center">Ficha anterior (legado)</summary>
                <ul aria-label="Ficha anterior (legado)" className="mt-2 space-y-2">
                  {itens.map((item, idx) => (
                    <li key={idx} className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm text-on-surface">{item}</li>
                  ))}
                </ul>
              </details>
            )}
            <FichaFormulario clienteId={clienteId!} podeEditar={podeEditarFormulario} exigirAnamnese={exigirAnamnese && itens.length === 0} />
          </>
        ) : itens.length === 0 ? (
          <p className={`text-sm ${exigirAnamnese ? 'text-error' : 'text-on-surface-variant'}`}>
            Nenhuma ficha de anamnese registrada para este cliente.{exigirAnamnese && ' A empresa exige a ficha para agendar.'}
            {!onEditar && ' Só a supervisão e o profissional do atendimento registram a ficha.'}
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto custom-scrollbar space-y-2 pr-1">
            {itens.map((item, idx) => (
              <li key={idx} className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm text-on-surface">{item}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex justify-end gap-2">
          {onEditar && !formularioNovo && (
            <button type="button" onClick={onEditar} className="px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors">
              {restrita ? 'Atualizar ficha' : itens.length === 0 ? 'Preencher ficha' : 'Alterar ficha'}
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:bg-primary-dim transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
