import { useId } from 'react';
import { useModal } from '../hooks/useModal';
import { parseClientObservation } from '../utils/anamneseUtils';

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
}

// Visualização da ficha de anamnese (lista de clientes e agendamento); editar abre o AnamneseForm de quem chamou
export function FichaAnamneseModal({ nome, observacao, restrita = false, exigirAnamnese, onEditar, onClose }: Props) {
  useModal(true, onClose);
  const tituloId = useId();
  const itens = parseClientObservation(observacao).anamSummary;

  // Clique fora fecha, mas não o 2º clique de um duplo clique no nome que abriu o modal (cai no fundo)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && e.detail < 2) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-xl w-full border border-outline-variant/20">
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
          {onEditar && (
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
