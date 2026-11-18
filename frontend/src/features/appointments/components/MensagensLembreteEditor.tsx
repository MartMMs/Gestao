import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../../../api';
import {
  MAX_MENSAGENS_LEMBRETE, MAX_TAMANHO_MENSAGEM, VARIAVEIS_LEMBRETE,
  preencherMensagem, trechosMensagem, validarMensagensLembrete,
} from '@shared/mensagemLembrete';

const CHAVE = ['whatsapp-mensagens'];
const EXEMPLO = Object.fromEntries(VARIAVEIS_LEMBRETE.map((v) => [v.chave, v.exemplo]));
const SUGESTAO = 'Olá, {nome}! Passando para lembrar do seu horário na {nome da empresa} em {data} às {horario}. Código da reserva: {numero da reserva}. Se não puder vir, avise a gente.';

// Caixa de texto com as chaves pintadas: o texto fica transparente numa camada de trás só para desenhar o fundo verde
// (reconhecida) ou vermelho (não existe) exatamente embaixo de cada chave
function CampoMensagem({ valor, onChange, rotulo, campoRef }: {
  valor: string; onChange: (v: string) => void; rotulo: string; campoRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const fundo = useRef<HTMLDivElement>(null);
  const estilo = 'w-full min-h-28 p-3 text-sm leading-6 font-sans whitespace-pre-wrap break-words rounded-xl';
  return (
    <div className="relative">
      <div ref={fundo} aria-hidden className={`${estilo} absolute inset-0 overflow-hidden text-transparent border border-transparent`}>
        {trechosMensagem(valor).map((t, i) => (t.tipo === 'texto'
          ? <span key={i}>{t.texto}</span>
          : <mark key={i} className={`text-transparent rounded ${t.tipo === 'chave' ? 'bg-green-300/70' : 'bg-red-300/70'}`}>{t.texto}</mark>))}
        {'\n'}
      </div>
      <textarea
        ref={campoRef}
        aria-label={rotulo}
        value={valor}
        maxLength={MAX_TAMANHO_MENSAGEM}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (fundo.current) fundo.current.scrollTop = e.currentTarget.scrollTop; }}
        className={`${estilo} relative bg-transparent border border-outline-variant text-on-surface resize-y focus:outline-primary`}
      />
    </div>
  );
}

export function MensagensLembreteEditor({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ mensagens: string[] }>({ queryKey: CHAVE, queryFn: () => fetchApi('/whatsapp/mensagens', token) });
  const [mensagens, setMensagens] = useState<string[]>([]);
  const [ativa, setAtiva] = useState(0);
  const campos = useRef<(HTMLTextAreaElement | null)[]>([]);
  useEffect(() => { if (data) setMensagens(data.mensagens); }, [data]);

  const salvar = useMutation({
    mutationFn: (lista: string[]) => fetchApi('/whatsapp/mensagens', token, { method: 'PUT', body: JSON.stringify({ mensagens: lista }) }),
    onSuccess: (resposta: { mensagens: string[] }) => queryClient.setQueryData(CHAVE, resposta),
  });
  const erro = mensagens.length ? validarMensagensLembrete(mensagens) : null;

  const trocar = (i: number, valor: string) => setMensagens((lista) => lista.map((m, j) => (j === i ? valor : m)));
  // Põe a chave onde está o cursor da mensagem que foi clicada por último
  const inserir = (chave: string) => {
    if (!mensagens.length) { setMensagens([`{${chave}}`]); return; }
    const campo = campos.current[ativa];
    const atual = mensagens[ativa] ?? '';
    const ini = campo?.selectionStart ?? atual.length;
    const fim = campo?.selectionEnd ?? atual.length;
    trocar(ativa, `${atual.slice(0, ini)}{${chave}}${atual.slice(fim)}`);
    requestAnimationFrame(() => { campo?.focus(); const pos = ini + chave.length + 2; campo?.setSelectionRange(pos, pos); });
  };

  return (
    <div className="space-y-4 border-t border-outline-variant pt-6">
      <div>
        <h3 className="text-base font-bold text-on-surface">Mensagens do lembrete</h3>
        <p className="text-sm text-on-surface-variant mt-1">
          Escreva a frase e coloque as informações do cliente entre chaves, por exemplo <code>{'{nome}'}</code>. Quando o sistema reconhece a chave, ela fica <span className="bg-green-300/70 rounded px-1">verde</span>; se ficar <span className="bg-red-300/70 rounded px-1">vermelha</span>, está escrita errado.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          {mensagens.length === 0 && (
            <p className="text-sm text-on-surface-variant">Nenhuma mensagem: vai a mensagem padrão do sistema.</p>
          )}
          {mensagens.map((m, i) => (
            <div key={i} className="space-y-2" onFocus={() => setAtiva(i)}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Mensagem {i + 1}</span>
                <button type="button" onClick={() => setMensagens((l) => l.filter((_, j) => j !== i))} className="text-xs text-error cursor-pointer">Remover</button>
              </div>
              <CampoMensagem valor={m} onChange={(v) => trocar(i, v)} rotulo={`Mensagem ${i + 1}`} campoRef={(el) => { campos.current[i] = el; }} />
              <div className="text-sm bg-surface-container rounded-xl p-3 whitespace-pre-wrap">
                <span className="block text-xs font-bold text-on-surface-variant mb-1">Como o cliente vai receber:</span>
                {preencherMensagem(m, EXEMPLO)}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {mensagens.length < MAX_MENSAGENS_LEMBRETE && (
              <button type="button" onClick={() => { setMensagens((l) => [...l, l.length ? '' : SUGESTAO]); setAtiva(mensagens.length); }}
                className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container text-primary cursor-pointer">
                + Nova mensagem
              </button>
            )}
            <button type="button" disabled={!!erro || salvar.isPending} onClick={() => salvar.mutate(mensagens)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary cursor-pointer disabled:opacity-50">
              {salvar.isPending ? 'Salvando…' : 'Salvar mensagens'}
            </button>
          </div>
          {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
          {salvar.isError && <p role="alert" className="text-sm text-error">{(salvar.error as Error).message}</p>}
          {salvar.isSuccess && !salvar.isPending && <p className="text-sm text-primary" aria-live="polite">Mensagens salvas.</p>}
        </div>

        <aside className="space-y-3">
          <h4 className="text-xs font-bold uppercase text-on-surface-variant">Chaves disponíveis (clique para inserir)</h4>
          <ul className="space-y-2">
            {VARIAVEIS_LEMBRETE.map((v) => (
              <li key={v.chave}>
                <button type="button" onClick={() => inserir(v.chave)} className="text-left w-full cursor-pointer">
                  <span className="bg-green-300/70 rounded px-1 text-sm font-mono">{`{${v.chave}}`}</span>
                  <span className="block text-xs text-on-surface-variant">{v.explicacao}. Ex.: {v.exemplo}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="text-xs text-on-surface-variant bg-surface-container rounded-xl p-3 space-y-1">
            <p className="font-bold">Dicas</p>
            <p>• Crie 3 ou mais mensagens diferentes: o sistema sorteia uma a cada envio, e textos que variam ajudam o número a não ser bloqueado.</p>
            <p>• Mensagem curta e com o nome da casa: o cliente reconhece quem está falando.</p>
            <p>• Não coloque o serviço nem dados de saúde: outra pessoa pode ver o celular do cliente.</p>
            <p>• Não coloque links: mensagens com link são as mais denunciadas como spam.</p>
            <p>• Use *asteriscos* para deixar em <strong>negrito</strong> no WhatsApp.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
