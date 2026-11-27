import { useEffect, useMemo, useState } from 'react';
import { formatarDataHoraBR } from '@shared/datasBR';
import { obrigatoriaPendente, paraPublico, textoDoValor, type ValorResposta } from '@shared/formularioAnamnese';
import { useAuth } from '../AuthContext';
import { useFichasCliente, useFormularioEquipe, useSalvarFichaCliente } from '../api';
import { CamposDinamicos } from './CamposDinamicos';

/** Selo discreto com as respostas marcadas como alerta (ex.: Gestante, Alergia). Sem alerta, não aparece. */
export function SeloAlertaClinico({ alertas }: { alertas?: string[] | null }) {
  if (!alertas?.length) return null;
  return (
    <span role="note" aria-label={`Alerta clínico: ${alertas.join(', ')}`} title={alertas.join(', ')}
      className="inline-flex items-center gap-1 bg-error/10 text-error px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[10px]">
      <span className="material-symbols-outlined text-[11px]" aria-hidden="true">warning</span>
      {alertas.join(' · ')}
    </span>
  );
}

/**
 * Ficha do formulário configurável na ficha do cliente: perguntas "Ambos", seção do profissional e o histórico
 * (somente leitura, com a cópia das perguntas de quando foi respondida: campos arquivados continuam legíveis).
 */
export function FichaFormulario({ clienteId, podeEditar, exigirAnamnese = false }: { clienteId: string; podeEditar: boolean; exigirAnamnese?: boolean }) {
  const { token } = useAuth();
  const { data: formulario } = useFormularioEquipe(token);
  const { data: fichas, error } = useFichasCliente(token, clienteId);
  const salvar = useSalvarFichaCliente(token);
  const [valores, setValores] = useState<Record<string, ValorResposta>>({});
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const ultima = fichas?.[0];
  // Há digitação não salva: uma ficha nova gravada por outra pessoa não apaga o que está na tela
  const [editado, setEditado] = useState(false);

  // Começa com as respostas da última ficha (por campo): a equipe só altera o que mudou
  useEffect(() => {
    if (!ultima?.snapshot || editado) return;
    setValores(Object.fromEntries(ultima.snapshot.itens.map((i) => [i.campoId, i.valor])));
  }, [ultima?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Ficha salva." some sozinho; erro fica até a próxima edição
  useEffect(() => {
    if (mensagem?.tipo !== 'ok') return;
    const t = setTimeout(() => setMensagem(null), 4000);
    return () => clearTimeout(t);
  }, [mensagem]);

  const campos = useMemo(() => formulario?.campos ?? [], [formulario]);
  const comuns = campos.filter((c) => c.canal === 'ambos').map(paraPublico);
  const doProfissional = campos.filter((c) => c.canal === 'apenas_profissional').map(paraPublico);

  if (error) return <p className="text-xs text-on-surface-variant">{(error as Error).message}</p>;

  const enviar = async () => {
    setMensagem(null);
    // Mesma regra da API: aponta a pergunta obrigatória que faltou
    const faltando = obrigatoriaPendente([...comuns, ...doProfissional], valores);
    if (faltando) { setMensagem({ tipo: 'erro', texto: `Responda: ${faltando.rotulo}` }); return; }
    try {
      await salvar.mutateAsync({ clienteId, respostas: valores });
      setEditado(false);
      setMensagem({ tipo: 'ok', texto: 'Ficha salva.' });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível salvar a ficha.' });
    }
  };
  const mudar = (id: string, v: ValorResposta) => { setValores((a) => ({ ...a, [id]: v })); setEditado(true); setMensagem(null); };

  return (
    <section aria-label="Formulário de anamnese" className="space-y-4 mt-4">
      {ultima && <SeloAlertaClinico alertas={ultima.alertas} />}
      {fichas && fichas.length === 0 && (
        <p className={`text-xs ${exigirAnamnese ? 'text-error' : 'text-on-surface-variant'}`}>
          Nenhuma resposta registrada no formulário ainda.{exigirAnamnese && ' A empresa exige a ficha para agendar.'}
          {!podeEditar && ' Só a supervisão e o profissional do atendimento registram a ficha.'}
        </p>
      )}
      {comuns.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Perguntas da ficha</h3>
          <CamposDinamicos idBase={`ficha-${clienteId}`} campos={comuns} valores={valores} onChange={mudar} desabilitado={!podeEditar} />
        </div>
      )}
      {doProfissional.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary mb-2">Anotações / Campos do Profissional</h3>
          <CamposDinamicos idBase={`ficha-prof-${clienteId}`} campos={doProfissional} valores={valores} onChange={mudar} desabilitado={!podeEditar} />
        </div>
      )}
      {podeEditar && campos.length > 0 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={enviar} disabled={salvar.isPending}
            className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest disabled:opacity-50">
            {salvar.isPending ? 'Salvando...' : 'Salvar respostas'}
          </button>
          {mensagem && <p role={mensagem.tipo === 'erro' ? 'alert' : 'status'} className={`text-xs ${mensagem.tipo === 'erro' ? 'text-error' : 'text-green-700 dark:text-green-400'}`}>{mensagem.texto}</p>}
        </div>
      )}
      {fichas && fichas.length > 0 && (
        <details className="rounded-xl border border-outline-variant/20 p-3">
          <summary className="text-xs font-bold text-on-surface-variant cursor-pointer">Histórico de fichas ({fichas.length})</summary>
          <ul aria-label="Histórico de fichas" className="mt-2 space-y-3">
            {fichas.map((f) => (
              <li key={f.id} className="text-xs text-on-surface">
                <p className="font-bold text-on-surface-variant">
                  {formatarDataHoraBR(f.preenchidoEm)} · {f.canal === 'totem' ? 'Totem' : f.canal === 'recepcao' ? 'Recepção' : 'Equipe'}
                </p>
                {f.snapshot ? (
                  <ul className="mt-1 space-y-0.5">
                    {f.snapshot.itens.map((i) => (
                      <li key={`${f.id}-${i.campoId}-${i.rotulo}`} className={i.alerta ? 'text-error font-bold' : ''}>
                        {i.rotulo}: {textoDoValor(i.valor)}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-on-surface-variant">Ficha em formato não reconhecido.</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
