import { useState, type FormEvent } from 'react';
import { obrigatoriaPendente, paraPublico, temRespostas, type ValorResposta } from '@shared/formularioAnamnese';
import { useAuth } from '../AuthContext';
import { useFormularioEquipe, useFormularioRecepcao, useSalvarFichaRecepcao } from '../api';
import { CamposDinamicos } from './CamposDinamicos';
import { ModalFormulario } from './ModalFormulario';


type Props = {
  nome: string;
  onClose: () => void;
  // Cliente cadastrado (recepção): grava direto, às cegas
  clienteId?: string;
  onSalvo?: () => void;
  // Cadastro ou reserva ainda sem cliente: só devolve as respostas, que vão junto com o envio
  valoresIniciais?: Record<string, ValorResposta>;
  onConfirmar?: (valores: Record<string, ValorResposta>) => void;
};

/**
 * Ficha nova no formulário configurável. Recepção (LGPD): só as perguntas do totem/ambos, sem ficha anterior nem
 * alerta clínico. Demais papéis: perguntas da equipe, com a seção do profissional.
 */
/** Perguntas que quem está logado preenche: recepção, as do balcão (totem/ambos); demais, as da equipe. */
export function usePerguntasDaFicha() {
  const { token, currentUser } = useAuth();
  const recepcao = currentUser?.role === 'receptionist';
  const doBalcao = useFormularioRecepcao(recepcao ? token : null);
  const daEquipe = useFormularioEquipe(token, !recepcao);
  const { error, isLoading } = recepcao ? doBalcao : daEquipe;
  const todos = recepcao ? doBalcao.data?.campos ?? [] : (daEquipe.data?.campos ?? []).map(paraPublico);
  const doProfissional = new Set(recepcao ? [] : (daEquipe.data?.campos ?? []).filter((c) => c.canal === 'apenas_profissional').map((c) => c.id));
  return {
    recepcao, error, isLoading, todos,
    comuns: todos.filter((c) => !doProfissional.has(c.id)),
    prof: todos.filter((c) => doProfissional.has(c.id)),
    // Só o formulário inteiro vazio dispensa a ficha obrigatória (mesma regra da API); a equipe vê "ambos" também
    semPerguntas: (recepcao ? doBalcao.data : daEquipe.data)?.formularioVazio === true,
  };
}

export function FichaNovaModal({ nome, onClose, clienteId, onSalvo, valoresIniciais, onConfirmar }: Props) {
  const { token } = useAuth();
  const { recepcao, error, isLoading, todos, comuns, prof } = usePerguntasDaFicha();
  const salvar = useSalvarFichaRecepcao(token);
  const [valores, setValores] = useState<Record<string, ValorResposta>>(valoresIniciais ?? {});
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const faltando = obrigatoriaPendente(todos, valores);
    if (faltando) { setErro(`Responda: ${faltando.rotulo}`); return; }
    if (onConfirmar) { onConfirmar(valores); onClose(); return; }
    try {
      await salvar.mutateAsync({ clienteId: clienteId!, respostas: valores });
      onSalvo?.();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível salvar a ficha.');
    }
  };
  const mudar = (id: string, v: ValorResposta) => { setValores((a) => ({ ...a, [id]: v })); setErro(null); };

  return (
    <ModalFormulario
      title="Nova ficha de anamnese"
      onClose={onClose}
      onSubmit={enviar}
      submitLabel={onConfirmar ? 'Concluir ficha' : 'Salvar ficha'}
      submitDisabled={todos.length === 0}
      isSubmitting={salvar.isPending}
      hasUnsavedChanges={JSON.stringify(valores) !== JSON.stringify(valoresIniciais ?? {}) && temRespostas(valores)}
      infoBanner={<p className="text-xs">Nova ficha de {nome || 'cliente'}.{recepcao && ' Por privacidade (LGPD), fichas anteriores e alertas clínicos não são exibidos para a recepção.'}</p>}
      alertBanner={erro ? <p role="alert">{erro}</p> : undefined}
    >
      {isLoading ? <p className="text-sm text-on-surface-variant">Carregando perguntas...</p>
        : error ? <p role="alert" className="text-sm text-error">{(error as Error).message}</p>
        : todos.length === 0 ? <p className="text-sm text-on-surface-variant">{recepcao ? 'Não há perguntas da ficha para a recepção. Peça à supervisão para incluir perguntas "Totem" ou "Ambos".' : 'A empresa ainda não configurou perguntas na ficha.'}</p>
        : (
          <>
            <CamposDinamicos idBase="ficha-nova" campos={comuns} valores={valores} onChange={mudar} />
            {prof.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Anotações / Campos do Profissional</h3>
                <CamposDinamicos idBase="ficha-nova-prof" campos={prof} valores={valores} onChange={mudar} />
              </div>
            )}
          </>
        )}
    </ModalFormulario>
  );
}
