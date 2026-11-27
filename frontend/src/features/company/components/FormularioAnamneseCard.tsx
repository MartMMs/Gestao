import { useState } from 'react';
import { useAuth } from '../../../AuthContext';
import { PersonalizarFormularioModal } from './PersonalizarFormularioModal';

/** Atalho do editor do formulário na aba Totem & Autoatendimento (a supervisão não abre Empresa & Segmento). */
export function FormularioAnamneseCard() {
  const { currentUser } = useAuth();
  const [aberto, setAberto] = useState(false);
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'supervisor') return null;
  return (
    <section aria-labelledby="formulario-anamnese-titulo" className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
      <div>
        <h3 id="formulario-anamnese-titulo" className="text-lg font-headline text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary" aria-hidden="true">assignment</span>
          Formulário de anamnese
        </h3>
        <p className="text-xs text-on-surface-variant mt-1">Perguntas que o cliente responde no totem e que a equipe preenche na ficha do cliente.</p>
      </div>
      <button type="button" onClick={() => setAberto(true)} className="min-h-11 px-4 rounded-xl border border-primary text-primary text-xs font-bold inline-flex items-center gap-1 shrink-0">
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_note</span>
        Personalizar formulário
      </button>
      {aberto && <PersonalizarFormularioModal onClose={() => setAberto(false)} />}
    </section>
  );
}
