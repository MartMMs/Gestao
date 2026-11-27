import { useState, type FormEvent } from 'react';
import type { ValorResposta } from '@shared/formularioAnamnese';
import { useAuth } from '../AuthContext';
import { useFormularioRecepcao, useSalvarFichaRecepcao } from '../api';
import { CamposDinamicos } from './CamposDinamicos';
import { ModalFormulario } from './ModalFormulario';

const vazio = (v: ValorResposta | undefined) => (Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim());

/** Ficha nova pela recepção, às cegas (LGPD): só as perguntas do totem/ambos, sem ficha anterior nem alerta clínico. */
export function FichaRecepcaoModal({ clienteId, nome, onClose, onSalvo }: { clienteId: string; nome: string; onClose: () => void; onSalvo?: () => void }) {
  const { token } = useAuth();
  const { data, error, isLoading } = useFormularioRecepcao(token);
  const salvar = useSalvarFichaRecepcao(token);
  const [valores, setValores] = useState<Record<string, ValorResposta>>({});
  const [erro, setErro] = useState<string | null>(null);
  const campos = data?.campos ?? [];

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const faltando = campos.find((c) => c.obrigatorio && vazio(valores[c.id]));
    if (faltando) { setErro(`Responda: ${faltando.rotulo}`); return; }
    try {
      await salvar.mutateAsync({ clienteId, respostas: valores });
      onSalvo?.();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a ficha.');
    }
  };

  return (
    <ModalFormulario
      title="Nova ficha de anamnese"
      onClose={onClose}
      onSubmit={enviar}
      submitLabel="Salvar ficha"
      submitDisabled={campos.length === 0}
      isSubmitting={salvar.isPending}
      hasUnsavedChanges={Object.values(valores).some((v) => !vazio(v))}
      infoBanner={<p className="text-xs">Nova ficha de {nome}. Por privacidade (LGPD), fichas anteriores e alertas clínicos não são exibidos para a recepção.</p>}
      alertBanner={erro ? <p role="alert">{erro}</p> : undefined}
    >
      {isLoading ? <p className="text-sm text-on-surface-variant">Carregando perguntas...</p>
        : error ? <p role="alert" className="text-sm text-error">{(error as Error).message}</p>
        : campos.length === 0 ? <p className="text-sm text-on-surface-variant">A empresa ainda não configurou perguntas na ficha.</p>
        : <CamposDinamicos idBase={`recepcao-${clienteId}`} campos={campos} valores={valores} onChange={(id, v) => { setValores((a) => ({ ...a, [id]: v })); setErro(null); }} />}
    </ModalFormulario>
  );
}
