import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirmarSaida, useModal } from '../../../hooks/useModal';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { CamposDinamicos } from '../../../components/CamposDinamicos';
import { useAuth } from '../../../AuthContext';
import { useAplicarPreset, useFormularioAnamnese, useSalvarFormulario } from '../../../api';
import { CODIGO_CONFIG_DESATUALIZADA } from '@shared/codigosErro';
import {
  camposDoCanal, editarOpcoes, errosDoCampo, mudarTipoCampo, paraPublico, OPCOES_SIM_NAO,
  type CampoFormulario, type CanalCampo, type TipoCampo, type ValorResposta,
} from '@shared/formularioAnamnese';
import { isApiError } from '../../../api';

type Rascunho = Omit<CampoFormulario, 'versao' | 'id'> & { id: string | null; temp: string };
type Aba = 'editar' | 'totem' | 'profissional';

const TIPOS: Record<TipoCampo, string> = {
  sim_nao: 'Sim / Não', escolha_unica: 'Escolha única', multipla_escolha: 'Múltipla escolha', texto_livre: 'Texto livre',
};
const CANAIS: Record<CanalCampo, string> = { ambos: 'Ambos', apenas_totem: 'Só no Totem', apenas_profissional: 'Só para o Profissional' };

const campoCss = 'w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 min-h-11 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none';
const rotuloCss = 'block text-[11px] font-bold text-on-surface-variant tracking-[0.1em] uppercase mb-1';
const seloCss = 'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider';
const segmento = (ativo: boolean) => `min-h-11 px-3 rounded-lg text-xs font-bold ${ativo ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`;

let contador = 0;
const novoTemp = () => `novo-${(contador += 1)}`;
const paraRascunho = (c: CampoFormulario): Rascunho => ({ ...c, temp: c.id });

function EditorOpcoes({ campo, nome, onChange }: { campo: Rascunho; nome: string; onChange: (opcoes: string[]) => void }) {
  const [nova, setNova] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const adicionar = () => {
    const texto = nova.trim();
    if (!texto) return;
    onChange([...campo.opcoes, texto]);
    setNova('');
  };
  const mover = (i: number, passo: -1 | 1) => {
    const lista = [...campo.opcoes];
    [lista[i], lista[i + passo]] = [lista[i + passo], lista[i]];
    onChange(lista);
  };
  return (
    <fieldset className="sm:col-span-2">
      <legend className={rotuloCss}>Opções</legend>
      <ul className="space-y-2" aria-label={`Opções de ${nome}`}>
        {campo.opcoes.map((opcao, i) => (
          <li key={i} className="flex items-center gap-1">
            <input ref={(el) => { refs.current[i] = el; }} type="text" maxLength={80} value={opcao} aria-label={`Opção ${i + 1} de ${nome}`}
              onChange={(e) => onChange(campo.opcoes.map((o, j) => (j === i ? e.target.value : o)))} className={`${campoCss} flex-1 min-w-0`} />
            <button type="button" aria-label={`Subir opção ${opcao || i + 1}`} disabled={i === 0} onClick={() => mover(i, -1)} className="min-h-11 min-w-11 rounded-lg hover:bg-surface-container disabled:opacity-30">
              <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_upward</span>
            </button>
            <button type="button" aria-label={`Descer opção ${opcao || i + 1}`} disabled={i === campo.opcoes.length - 1} onClick={() => mover(i, 1)} className="min-h-11 min-w-11 rounded-lg hover:bg-surface-container disabled:opacity-30">
              <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_downward</span>
            </button>
            <button type="button" aria-label={`Remover opção ${opcao || i + 1}`} onClick={() => onChange(campo.opcoes.filter((_, j) => j !== i))} className="min-h-11 min-w-11 rounded-lg text-error hover:bg-error/10">
              <span className="material-symbols-outlined text-base" aria-hidden="true">close</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-2">
        <input type="text" maxLength={80} value={nova} placeholder="Nova opção (Enter para adicionar)" aria-label={`Nova opção de ${nome}`}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } }}
          className={`${campoCss} flex-1 min-w-0`} />
        <button type="button" onClick={adicionar} disabled={!nova.trim()} className="min-h-11 px-3 rounded-xl border border-primary text-primary text-xs font-bold disabled:opacity-40 whitespace-nowrap">
          + Adicionar opção
        </button>
      </div>
    </fieldset>
  );
}

/** Editor do formulário de anamnese (Empresa & Segmento e Totem & Autoatendimento): perguntas do totem e da ficha da equipe. */
export function PersonalizarFormularioModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const { data, isLoading, error, refetch } = useFormularioAnamnese(token);
  const salvar = useSalvarFormulario(token);
  const preset = useAplicarPreset(token);
  const tituloId = useId();
  const [aba, setAba] = useState<Aba>('editar');
  const [campos, setCampos] = useState<Rascunho[] | null>(null);
  const [versao, setVersao] = useState(0);
  const [alterado, setAlterado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [focar, setFocar] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string; desatualizado?: boolean } | null>(null);
  const [arquivando, setArquivando] = useState<Rascunho | null>(null);
  const [confirmarPreset, setConfirmarPreset] = useState(false);
  const [previa, setPrevia] = useState<Record<string, ValorResposta>>({});
  const rotuloRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Carrega do servidor só enquanto não há edição em andamento (o aviso em tempo real não apaga o que foi digitado)
  useEffect(() => {
    if (data && !alterado) { setCampos(data.campos.map(paraRascunho)); setVersao(data.versao); }
  }, [data, alterado]);
  // Pergunta nova: abre o card e põe o cursor na pergunta
  useEffect(() => {
    if (!focar) return;
    const el = rotuloRefs.current[focar];
    if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); setFocar(null); }
  });

  const lista = campos ?? [];
  const ativos = lista.filter((c) => c.ativa);
  const arquivados = lista.filter((c) => !c.ativa);
  const comErro = ativos.filter((c) => errosDoCampo(c).length > 0);
  const mudar = (temp: string, mudanca: Partial<Rascunho> | ((c: Rascunho) => Rascunho)) => {
    setCampos((atual) => (atual ?? []).map((c) => (c.temp === temp ? (typeof mudanca === 'function' ? mudanca(c) : { ...c, ...mudanca }) : c)));
    setAlterado(true);
    setMensagem(null);
  };
  const mover = (temp: string, passo: -1 | 1) => {
    const ordem = [...ativos];
    const i = ordem.findIndex((c) => c.temp === temp);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= ordem.length) return;
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
    setCampos([...ordem, ...arquivados]);
    setAlterado(true);
  };
  const adicionar = () => {
    const temp = novoTemp();
    setCampos([...ativos, {
      id: null, temp, chave: '', rotulo: '', ajuda: null, tipo: 'sim_nao', opcoes: [], canal: 'ambos',
      obrigatorio: false, dadoSensivel: true, respostasAlerta: [], ordem: ativos.length, ativa: true,
    }, ...arquivados]);
    setAba('editar');
    setAberto(temp);
    setFocar(temp);
    setAlterado(true);
    setMensagem(null);
  };

  const recarregar = async () => {
    setAlterado(false);
    setMensagem(null);
    await refetch();
  };

  const enviar = async () => {
    setMensagem(null);
    if (comErro.length > 0) {
      setAberto(comErro[0].temp);
      setMensagem({ tipo: 'erro', texto: `Corrija a pergunta "${comErro[0].rotulo || 'sem texto'}": ${errosDoCampo(comErro[0])[0]}` });
      return;
    }
    try {
      // A ordem é a posição: ativos primeiro, na ordem da tela; os arquivados depois. Opção em branco não vai
      const gravado = await salvar.mutateAsync({
        versao,
        campos: [...ativos, ...arquivados].map(({ temp: _temp, ...c }, ordem) => ({ ...c, opcoes: c.opcoes.map((o) => o.trim()).filter(Boolean), ordem })),
      });
      setCampos(gravado.campos.map(paraRascunho));
      setVersao(gravado.versao);
      setAlterado(false);
      setMensagem({ tipo: 'ok', texto: 'Formulário salvo. O totem e a ficha da equipe já usam as novas perguntas.' });
    } catch (err) {
      const desatualizado = isApiError(err) && (err.code === CODIGO_CONFIG_DESATUALIZADA || err.status === 409);
      setMensagem({
        tipo: 'erro', desatualizado,
        texto: desatualizado
          ? 'Outra pessoa salvou o formulário enquanto você editava. Recarregue para ver a versão atual (suas alterações desta tela serão descartadas).'
          : err instanceof Error ? err.message : 'Não foi possível salvar o formulário.',
      });
    }
  };

  const aplicarPreset = async () => {
    try {
      const gravado = await preset.mutateAsync();
      setCampos(gravado.campos.map(paraRascunho));
      setVersao(gravado.versao);
      setAlterado(false);
      setConfirmarPreset(false);
      setMensagem({ tipo: 'ok', texto: 'Modelo do segmento carregado. As perguntas anteriores foram arquivadas; as fichas antigas continuam guardadas.' });
    } catch (err) {
      setConfirmarPreset(false);
      setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível carregar o modelo.' });
    }
  };

  // Prévia com o rascunho (ainda não salvo), na mesma regra de canal da API
  const previaCampos = (canal: 'totem' | 'profissional') => camposDoCanal(ativos.map((c, ordem) => ({ ...c, ordem })), canal)
    .map((c) => paraPublico({ ...c, id: c.temp, rotulo: c.rotulo || '(pergunta sem texto)', opcoes: c.opcoes.filter((o) => o.trim()) }));
  const fechar = () => confirmarSaida(alterado, onClose);
  useModal(true, fechar);

  // Portal: as abas da tela têm animação (transform), que prenderia o "fixed" dentro delas em vez da tela toda
  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-stretch sm:items-center justify-center z-70 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && e.detail < 2) fechar(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-surface-container-lowest sm:rounded-3xl shadow-xl w-full max-w-3xl h-dvh sm:h-auto sm:max-h-[90vh] flex flex-col border border-outline-variant/20 overflow-hidden">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 border-b border-outline-variant/20 space-y-3">
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-lg sm:text-xl font-headline text-primary">Personalizar formulário de anamnese</h2>
              <p className="text-xs text-on-surface-variant">Perguntas do totem e da ficha do cliente. Fichas já preenchidas não mudam.</p>
            </div>
            <button type="button" onClick={fechar} aria-label="Fechar o editor" className="min-h-11 min-w-11 hover:bg-surface-container rounded-full text-on-surface-variant shrink-0">
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div role="tablist" aria-label="Modo" className="flex gap-1 bg-surface-container-low p-1 rounded-xl">
              {([['editar', 'Editar'], ['totem', 'Prévia Totem'], ['profissional', 'Prévia Profissional']] as const).map(([valor, nome]) => (
                <button key={valor} type="button" role="tab" aria-selected={aba === valor} onClick={() => setAba(valor)} className={segmento(aba === valor)}>
                  {nome}
                </button>
              ))}
            </div>
            <button type="button" onClick={adicionar} disabled={!campos} className="min-h-11 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold disabled:opacity-50">
              + Nova pergunta
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-4 sm:p-6 space-y-3">
          {isLoading || !campos ? (
            <p role="status" className="text-sm text-on-surface-variant">{error ? (error as Error).message : 'Carregando formulário...'}</p>
          ) : aba !== 'editar' ? (
            <div className={aba === 'totem' ? 'max-w-xl mx-auto' : ''}>
              <p className="text-xs text-on-surface-variant mb-3">
                {aba === 'totem' ? 'Como o cliente vê no totem (perguntas "Ambos" e "Só no Totem").' : 'Como a equipe vê na ficha do cliente (perguntas "Ambos" e "Só para o Profissional").'}
                {' '}Dá para tocar e digitar: é a prévia do que está na tela, antes de salvar. * = obrigatória.
              </p>
              {previaCampos(aba).length === 0
                ? <p className="text-sm text-on-surface-variant">Nenhuma pergunta aparece aqui.</p>
                : <CamposDinamicos idBase={`previa-${aba}`} campos={previaCampos(aba)} valores={previa} onChange={(id, v) => setPrevia((p) => ({ ...p, [id]: v }))} />}
            </div>
          ) : (
            <>
              <ol aria-label="Perguntas ativas" className="space-y-2">
                {ativos.map((c, i) => {
                  const nome = c.rotulo.trim() || `Pergunta ${i + 1}`;
                  const erros = errosDoCampo(c);
                  const expandido = aberto === c.temp;
                  const painelId = `pergunta-${c.temp}`;
                  return (
                    <li key={c.temp} className={`rounded-2xl border ${erros.length ? 'border-error/60' : 'border-outline-variant/25'} bg-surface-container-low/50`}>
                      <div className="flex items-center gap-1 p-2">
                        <div className="flex flex-col shrink-0">
                          <button type="button" aria-label={`Subir ${nome}`} disabled={i === 0} onClick={() => mover(c.temp, -1)} className="min-h-[22px] min-w-11 rounded hover:bg-surface-container disabled:opacity-30">
                            <span className="material-symbols-outlined text-base" aria-hidden="true">expand_less</span>
                          </button>
                          <button type="button" aria-label={`Descer ${nome}`} disabled={i === ativos.length - 1} onClick={() => mover(c.temp, 1)} className="min-h-[22px] min-w-11 rounded hover:bg-surface-container disabled:opacity-30">
                            <span className="material-symbols-outlined text-base" aria-hidden="true">expand_more</span>
                          </button>
                        </div>
                        <button type="button" aria-expanded={expandido} aria-controls={painelId} onClick={() => setAberto(expandido ? null : c.temp)}
                          className="flex-1 min-w-0 min-h-11 text-left px-2 py-1 rounded-xl hover:bg-surface-container">
                          <span className="block text-sm font-bold text-on-surface truncate">{i + 1}. {c.rotulo.trim() || 'Pergunta sem texto'}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            <span className={`${seloCss} bg-surface-container text-on-surface-variant`}>{TIPOS[c.tipo]}</span>
                            <span className={`${seloCss} bg-surface-container text-on-surface-variant`}>{CANAIS[c.canal]}</span>
                            <span className={`${seloCss} ${c.obrigatorio ? 'bg-primary/15 text-primary' : 'bg-surface-container text-on-surface-variant'}`}>{c.obrigatorio ? 'Obrigatório' : 'Opcional'}</span>
                            {c.respostasAlerta.length > 0 && <span className={`${seloCss} bg-error/10 text-error`}>Alerta: {c.respostasAlerta.join(', ')}</span>}
                            {erros.length > 0 && <span className={`${seloCss} bg-error text-white`}>Revisar</span>}
                          </span>
                        </button>
                        <span className="material-symbols-outlined text-on-surface-variant shrink-0" aria-hidden="true">{expandido ? 'expand_less' : 'expand_more'}</span>
                      </div>
                      {expandido && (
                        <div id={painelId} className="px-3 sm:px-4 pb-4 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className="sm:col-span-2"><span className={rotuloCss}>Pergunta</span>
                              <input ref={(el) => { rotuloRefs.current[c.temp] = el; }} type="text" maxLength={120} value={c.rotulo}
                                onChange={(e) => mudar(c.temp, { rotulo: e.target.value })} className={campoCss} aria-label={`Rótulo da pergunta ${i + 1}`} />
                            </label>
                            <label className="sm:col-span-2"><span className={rotuloCss}>Texto de apoio (opcional)</span>
                              <input type="text" maxLength={200} value={c.ajuda ?? ''} placeholder="Ex.: Para a equipe se preparar"
                                onChange={(e) => mudar(c.temp, { ajuda: e.target.value || null })} className={campoCss} aria-label={`Ajuda de ${nome}`} />
                            </label>
                            <label><span className={rotuloCss}>Tipo</span>
                              <select value={c.tipo} aria-label={`Tipo de ${nome}`} className={campoCss}
                                onChange={(e) => mudar(c.temp, (atual) => mudarTipoCampo(atual, e.target.value as TipoCampo))}>
                                {(Object.keys(TIPOS) as TipoCampo[]).map((t) => <option key={t} value={t}>{TIPOS[t]}</option>)}
                              </select>
                            </label>
                            <label><span className={rotuloCss}>Visibilidade</span>
                              <select value={c.canal} aria-label={`Visibilidade de ${nome}`} onChange={(e) => mudar(c.temp, { canal: e.target.value as CanalCampo })} className={campoCss}>
                                {(Object.keys(CANAIS) as CanalCampo[]).map((t) => <option key={t} value={t}>{CANAIS[t]}</option>)}
                              </select>
                            </label>
                            {(c.tipo === 'escolha_unica' || c.tipo === 'multipla_escolha') && (
                              <EditorOpcoes campo={c} nome={nome} onChange={(opcoes) => mudar(c.temp, (atual) => editarOpcoes(atual, opcoes))} />
                            )}
                          </div>
                          <div role="radiogroup" aria-label={`Resposta de ${nome}`} className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
                            <button type="button" role="radio" aria-checked={!c.obrigatorio} onClick={() => mudar(c.temp, { obrigatorio: false })} className={segmento(!c.obrigatorio)}>Opcional</button>
                            <button type="button" role="radio" aria-checked={c.obrigatorio} onClick={() => mudar(c.temp, { obrigatorio: true })} className={segmento(c.obrigatorio)}>Obrigatório</button>
                          </div>
                          {c.obrigatorio && c.canal === 'apenas_profissional' && (
                            <p className="text-xs text-on-surface-variant">Obrigatória só na ficha da equipe: o cliente no totem não vê esta pergunta.</p>
                          )}
                          <label className="flex items-center gap-2 min-h-11 text-xs text-on-surface">
                            <input type="checkbox" className="h-5 w-5 accent-primary" checked={c.dadoSensivel} onChange={(e) => mudar(c.temp, { dadoSensivel: e.target.checked })} />
                            Dado sensível (LGPD): o totem pede a autorização de uso dos dados de saúde
                          </label>
                          {c.tipo !== 'texto_livre' && (
                            <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface">
                              <legend className="sr-only">Gerar alerta visual para respostas de {nome}</legend>
                              <span aria-hidden="true" className="font-bold">Alerta no Perfil Clínico quando responder:</span>
                              {(c.tipo === 'sim_nao' ? OPCOES_SIM_NAO : c.opcoes.filter((o) => o.trim())).map((o) => (
                                <label key={o} className="flex items-center gap-1 min-h-11">
                                  <input type="checkbox" className="h-5 w-5 accent-error" checked={c.respostasAlerta.includes(o)}
                                    onChange={(e) => mudar(c.temp, (atual) => ({ ...atual, respostasAlerta: e.target.checked ? [...atual.respostasAlerta, o] : atual.respostasAlerta.filter((r) => r !== o) }))} />
                                  {o}
                                </label>
                              ))}
                            </fieldset>
                          )}
                          {erros.length > 0 && (
                            <ul role="alert" className="text-xs text-error list-disc pl-5">{erros.map((e) => <li key={e}>{e}</li>)}</ul>
                          )}
                          <div className="flex justify-end">
                            <button type="button" onClick={() => (c.id ? setArquivando(c) : setCampos(lista.filter((x) => x.temp !== c.temp)))}
                              className="min-h-11 px-3 rounded-lg text-xs text-error font-bold hover:bg-error/10">
                              {c.id ? 'Arquivar pergunta' : 'Remover pergunta'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              {ativos.length === 0 && <p className="text-sm text-on-surface-variant">Nenhuma pergunta ativa. Use "+ Nova pergunta" ou carregue o modelo do segmento.</p>}
              {arquivados.length > 0 && (
                <details className="rounded-xl border border-outline-variant/20 p-3">
                  <summary className="text-xs font-bold text-on-surface-variant cursor-pointer min-h-11 flex items-center">Perguntas arquivadas ({arquivados.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {arquivados.map((c) => (
                      <li key={c.temp} className="flex items-center justify-between gap-2 text-sm text-on-surface-variant">
                        <span className="min-w-0 truncate">{c.rotulo}</span>
                        <button type="button" onClick={() => { setCampos([...ativos, { ...c, ativa: true }, ...arquivados.filter((x) => x.temp !== c.temp)]); setAlterado(true); }}
                          className="min-h-11 px-2 text-primary text-xs font-bold hover:underline shrink-0" aria-label={`Reativar ${c.rotulo}`}>Reativar</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div className="p-3 sm:p-4 border-t border-outline-variant/20 space-y-2">
          {mensagem && (
            <div role={mensagem.tipo === 'erro' ? 'alert' : 'status'} className={`text-xs flex flex-wrap items-center gap-2 ${mensagem.tipo === 'erro' ? 'text-error' : 'text-green-700 dark:text-green-400'}`}>
              <span>{mensagem.texto}</span>
              {mensagem.desatualizado && <button type="button" onClick={recarregar} className="min-h-11 px-3 rounded-lg border border-error font-bold">Recarregar versão atual</button>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setConfirmarPreset(true)} disabled={!campos} className="min-h-11 px-3 rounded-xl border border-outline-variant/30 text-xs font-bold text-on-surface hover:bg-surface-container">
              Carregar modelo do segmento
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={fechar} className="min-h-11 px-3 rounded-xl text-xs font-bold text-on-surface-variant">Fechar</button>
              <button type="button" onClick={enviar} disabled={!alterado || salvar.isPending} className="min-h-11 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest disabled:opacity-50">
                {salvar.isPending ? 'Salvando...' : 'Salvar formulário'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(arquivando)}
        title="Arquivar pergunta?"
        description={`"${arquivando?.rotulo}" deixa de aparecer no totem e na ficha. As fichas já preenchidas continuam guardadas com esta pergunta e a resposta dada. Salve o formulário para confirmar.`}
        confirmLabel="Arquivar"
        tone="primary"
        onClose={() => setArquivando(null)}
        onConfirm={() => { if (arquivando) mudar(arquivando.temp, { ativa: false }); setArquivando(null); }}
      />
      <ConfirmDialog
        open={confirmarPreset}
        title="Carregar modelo do segmento?"
        description="As perguntas ativas são substituídas pelas do modelo do segmento da empresa. As atuais ficam arquivadas (podem ser reativadas) e nenhuma resposta antiga é perdida. Alterações não salvas aqui são descartadas."
        confirmLabel="Carregar modelo"
        tone="primary"
        isSubmitting={preset.isPending}
        onClose={() => setConfirmarPreset(false)}
        onConfirm={aplicarPreset}
      />
    </div>,
    document.body,
  );
}
