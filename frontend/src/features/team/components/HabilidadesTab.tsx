import React, { useState } from 'react';
import { isApiError, useArquivarHabilidade, useHabilidades, useSalvarHabilidade } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import type { Habilidade } from '../../../types';

const CAMPO = 'h-11 px-3 bg-surface-container-lowest border border-outline-variant/20 rounded-xl text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none';

// Sub-aba "Habilidades" da Equipe: o cadastro que os serviços ("Por habilidade") e os profissionais usam.
// Arquivar não apaga: tira a habilidade das regras e guarda os vínculos (reativar volta tudo como estava)
export function HabilidadesTab({ setToastMessage, setErrorMessage }: {
  setToastMessage: (msg: string | null) => void;
  setErrorMessage: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const { data: habilidades = [], isLoading } = useHabilidades(token, true);
  const salvar = useSalvarHabilidade(token);
  const arquivar = useArquivarHabilidade(token);
  const [novoNome, setNovoNome] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [paraArquivar, setParaArquivar] = useState<Habilidade | null>(null);

  const erro = (e: unknown, padrao: string) => setErrorMessage(isApiError(e) ? e.message : padrao);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNome.trim() || salvar.isPending) return;
    try {
      await salvar.mutateAsync({ nome: novoNome });
      setNovoNome('');
      setToastMessage('Habilidade cadastrada.');
    } catch (err) { erro(err, 'Não foi possível cadastrar a habilidade.'); }
  };

  const renomear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando || salvar.isPending) return;
    try {
      await salvar.mutateAsync({ id: editando.id, nome: editando.nome });
      setEditando(null);
      setToastMessage('Habilidade renomeada.');
    } catch (err) { erro(err, 'Não foi possível renomear a habilidade.'); }
  };

  const reativar = async (h: Habilidade) => {
    try {
      await salvar.mutateAsync({ id: h.id, ativa: true });
      setToastMessage(`"${h.nome}" voltou a valer nos serviços e profissionais vinculados.`);
    } catch (err) { erro(err, 'Não foi possível reativar a habilidade.'); }
  };

  const confirmarArquivar = async () => {
    if (!paraArquivar) return;
    try {
      await arquivar.mutateAsync(paraArquivar.id);
      setToastMessage(`"${paraArquivar.nome}" arquivada.`);
      setParaArquivar(null);
    } catch (err) { erro(err, 'Não foi possível arquivar a habilidade.'); }
  };

  const servicosAfetados = paraArquivar?.servicosAtivos ?? 0;

  return (
    <div className="space-y-6">
      <section className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant/20">
        <h3 className="text-lg font-headline text-on-surface">Habilidades</h3>
        <p className="text-sm text-on-surface-variant mt-1">
          Cadastre o que cada profissional sabe fazer. Serviços com a regra "Por habilidade" só são oferecidos a quem tem uma das habilidades exigidas.
        </p>
        <form onSubmit={criar} className="mt-4 flex flex-wrap gap-2 items-end">
          <label className="block text-xs font-bold text-on-surface-variant">
            Nova habilidade
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} maxLength={60} placeholder="Ex.: Drenagem linfática" className={`mt-1 block w-72 max-w-full ${CAMPO}`} />
          </label>
          <button type="submit" disabled={!novoNome.trim() || salvar.isPending} className="h-11 px-5 rounded-xl bg-primary text-on-primary text-sm font-bold disabled:opacity-50">
            Cadastrar
          </button>
        </form>
      </section>

      <section aria-label="Habilidades cadastradas" className="bg-surface-container-lowest rounded-3xl border border-outline-variant/20 divide-y divide-outline-variant/10">
        {isLoading && <p className="p-6 text-sm text-on-surface-variant">Carregando...</p>}
        {!isLoading && habilidades.length === 0 && <p className="p-6 text-sm text-on-surface-variant">Nenhuma habilidade cadastrada ainda.</p>}
        {habilidades.map((h) => (
          <div key={h.id} role="group" aria-label={h.nome} className={`p-4 flex flex-wrap items-center gap-3 ${h.ativa ? '' : 'opacity-70'}`}>
            {editando?.id === h.id ? (
              <form onSubmit={renomear} className="flex flex-wrap gap-2 items-center flex-1">
                <input aria-label={`Novo nome de ${h.nome}`} autoFocus value={editando.nome} onChange={(e) => setEditando({ id: h.id, nome: e.target.value })} maxLength={60} className={`flex-1 min-w-40 ${CAMPO}`} />
                <button type="submit" disabled={salvar.isPending} className="h-11 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold">Salvar</button>
                <button type="button" onClick={() => setEditando(null)} className="h-11 px-4 rounded-xl text-xs font-bold text-on-surface-variant hover:bg-surface-container">Cancelar</button>
              </form>
            ) : (
              <>
                <div className="flex-1 min-w-40">
                  <p className="font-bold text-on-surface">
                    {h.nome}
                    {!h.ativa && <span className="ml-2 text-[10px] uppercase tracking-widest font-bold text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">Arquivada</span>}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {h.servicosAtivos ?? 0} serviço(s) ativo(s) · {h.colaboradores ?? 0} profissional(is)
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditando({ id: h.id, nome: h.nome })} className="min-h-11 px-3 rounded-xl text-xs font-bold text-primary hover:bg-primary/10">Renomear</button>
                  {h.ativa
                    ? <button type="button" onClick={() => setParaArquivar(h)} className="min-h-11 px-3 rounded-xl text-xs font-bold text-error hover:bg-error/10">Arquivar</button>
                    : <button type="button" onClick={() => reativar(h)} disabled={salvar.isPending} className="min-h-11 px-3 rounded-xl text-xs font-bold text-primary hover:bg-primary/10">Reativar</button>}
                </div>
              </>
            )}
          </div>
        ))}
      </section>

      <ConfirmDialog
        open={Boolean(paraArquivar)}
        title={`Arquivar a habilidade ${paraArquivar?.nome ?? ''}?`}
        description={servicosAfetados > 0
          ? `${servicosAfetados} serviço(s) ativo(s) exigem esta habilidade. Arquivada, ela deixa de contar: se for a única exigida, qualquer profissional passa a atender esses serviços. Os vínculos ficam guardados e voltam ao reativar.`
          : 'Nenhum serviço ativo usa esta habilidade. Ela sai das listas e os vínculos ficam guardados (reativar volta tudo como estava).'}
        confirmLabel="Sim, arquivar"
        confirmingLabel="Arquivando..."
        cancelLabel="Manter ativa"
        icon="inventory_2"
        isSubmitting={arquivar.isPending}
        onClose={() => setParaArquivar(null)}
        onConfirm={confirmarArquivar}
      />
    </div>
  );
}
