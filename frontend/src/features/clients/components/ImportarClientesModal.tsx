import React, { useRef, useState } from 'react';
import { ModalFormulario } from '../../../components/ModalFormulario';
import { useAuth } from '../../../AuthContext';
import { useImportClients, type PreviaImportacao } from '../../../api';
import { lerPlanilhaClientes, type LinhaCliente } from '../utils/planilhaClientes';

/**
 * Importação em 2 passos: escolher o arquivo (o navegador confere tipo e conteúdo e lê as linhas) e ver a prévia
 * validada pela API. Só grava com a prévia sem erros, e grava tudo ou nada.
 */
export function ImportarClientesModal({ onClose, setToastMessage }: { onClose: () => void; setToastMessage?: (msg: string | null) => void }) {
  const { token } = useAuth();
  const { mutateAsync: importar } = useImportClients(token);
  // Gravação separada da prévia (antes as duas dividiam um isPending), com trava síncrona contra duplo clique
  const [gravando, setGravando] = useState(false);
  const gravandoRef = useRef(false);
  const [nomeArquivo, setNomeArquivo] = useState('');
  const [linhas, setLinhas] = useState<LinhaCliente[] | null>(null);
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const escolher = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo depois de corrigir
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setLinhas(null);
    setPrevia(null);
    setErro(null);
    setLendo(true);
    try {
      const lidas = await lerPlanilhaClientes(arquivo);
      setPrevia(await importar({ linhas: lidas, confirmar: false }));
      setLinhas(lidas);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível ler o arquivo.');
    } finally {
      setLendo(false);
    }
  };

  const confirmar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!linhas || !previa || previa.erros.length || gravandoRef.current) return;
    gravandoRef.current = true;
    setGravando(true);
    setErro(null);
    try {
      const resultado = await importar({ linhas, confirmar: true });
      setToastMessage?.(`${resultado.importados ?? resultado.validos} cliente(s) importado(s).`);
      onClose();
    } catch (error) {
      // Ex.: alguém cadastrou um dos nomes enquanto a prévia estava aberta. Nada foi gravado: refaz a prévia para
      // mostrar, linha a linha, o que mudou (em vez de deixar a antiga, "sem erros", na tela)
      setErro(`${error instanceof Error ? error.message : 'Não foi possível importar.'} Nada foi gravado.`);
      setPrevia(await importar({ linhas, confirmar: false }).catch(() => null));
    } finally {
      gravandoRef.current = false;
      setGravando(false);
    }
  };

  const podeImportar = !!previa && previa.erros.length === 0 && previa.validos > 0;

  return (
    <ModalFormulario
      title="Importar clientes"
      onClose={onClose}
      onSubmit={confirmar}
      submitLabel={podeImportar && previa ? `Importar ${previa.validos} cliente(s)` : 'Importar'}
      submittingLabel="Importando..."
      submitDisabled={!podeImportar || lendo}
      isSubmitting={gravando}
      hasUnsavedChanges={!!previa}
    >
      <p className="text-sm text-on-surface-variant">
        Arquivo <strong>.csv</strong> ou <strong>.xlsx</strong> (até 2 MB e 500 clientes). A primeira linha deve ter os títulos:
        <strong> Nome</strong> (obrigatório), Telefone, CPF e E-mail.
      </p>
      <label className="block text-xs font-bold text-on-surface-variant">
        Planilha
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={escolher}
          disabled={lendo || gravando}
          className="mt-1 block w-full text-sm text-on-surface file:mr-3 file:rounded-xl file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-bold file:text-on-primary"
        />
      </label>
      {lendo && <p role="status" className="text-sm text-on-surface-variant">Lendo e conferindo {nomeArquivo}...</p>}
      {erro && <p role="alert" className="text-sm text-error">{erro}</p>}

      {previa && (
        <div role="status" className="space-y-3">
          <p className="text-sm text-on-surface">
            <strong>{previa.total}</strong> linha(s): <strong className="text-primary">{previa.validos} pronta(s)</strong>
            {previa.erros.length > 0 && <>, <strong className="text-error">{previa.erros.length} erro(s)</strong></>}
            {previa.ignoradas ? <>, {previa.ignoradas} em branco (ignorada{previa.ignoradas > 1 ? 's' : ''})</> : null}.
          </p>
          {previa.erros.length > 0 && (
            <>
              <p className="text-sm text-on-surface-variant">Nada será gravado enquanto houver erros. Corrija a planilha e escolha o arquivo de novo.</p>
              <div className="max-h-60 overflow-y-auto rounded-xl border border-outline-variant/20">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low text-left text-xs text-on-surface-variant">
                    <tr><th scope="col" className="px-3 py-2">Linha</th><th scope="col" className="px-3 py-2">Problema</th></tr>
                  </thead>
                  <tbody>
                    {previa.erros.map((e, i) => (
                      <tr key={i} className="border-t border-outline-variant/10">
                        <td className="px-3 py-2 tabular-nums">{e.linha}</td>
                        <td className="px-3 py-2">{e.mensagem}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </ModalFormulario>
  );
}
