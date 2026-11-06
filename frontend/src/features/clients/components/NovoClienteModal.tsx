import React, { useState } from 'react';
import { ModalFormulario } from '../../../components/ModalFormulario';
import { useAuth } from '../../../AuthContext';
import { useCompanyConfig, useCreateClient } from '../../../api';
import { AnamneseForm, initialAnamnese, type AnamneseData } from '../../../components/AnamneseForm';
import { formatAnamneseStorage, hasAnamnese } from '../../../utils/anamneseUtils';
import { formatCpf, formatPhone } from '../../../utils/formatters';
import { lerCliente } from '@shared/clientes';
import { MENSAGEM_ANAMNESE_OBRIGATORIA } from '@shared/anamnese';

const CAMPO = 'mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none';

export function NovoClienteModal({ onClose, setToastMessage }: { onClose: () => void; setToastMessage?: (msg: string | null) => void }) {
  const { token } = useAuth();
  const { mutateAsync: criar, isPending } = useCreateClient(token);
  const [form, setForm] = useState({ nome: '', telefone: '', cpf: '', email: '' });
  const [erro, setErro] = useState<string | null>(null);
  const { data: empresa } = useCompanyConfig(token);
  const exigirAnamnese = empresa?.exigirAnamnese === true;
  const [ficha, setFicha] = useState<AnamneseData>(initialAnamnese);
  const [fichaAberta, setFichaAberta] = useState(false);
  const fichaPreenchida = hasAnamnese(ficha);
  const alterar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const valor = campo === 'telefone' ? formatPhone(e.target.value) : campo === 'cpf' ? formatCpf(e.target.value) : e.target.value;
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    setErro(null);
    // Mesmas regras da API, todas de uma vez (a API repete a conferência)
    const problemas = lerCliente(form).erros.map((e) => e.mensagem);
    if (exigirAnamnese && !fichaPreenchida) problemas.push(MENSAGEM_ANAMNESE_OBRIGATORIA);
    if (problemas.length) {
      setErro(problemas.join(' '));
      return;
    }
    try {
      const criado = await criar({ ...form, ...(fichaPreenchida ? { observacao: formatAnamneseStorage('', ficha) } : {}) });
      setToastMessage?.(`Cliente ${criado.nome} cadastrado${criado.codigo ? ` (#${criado.codigo})` : ''}.`);
      onClose();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível cadastrar o cliente.');
    }
  };

  return (
    <>
    <ModalFormulario
      title="Novo cliente"
      onClose={onClose}
      onSubmit={salvar}
      submitLabel="Cadastrar"
      submittingLabel="Salvando..."
      isSubmitting={isPending}
      hasUnsavedChanges={Object.values(form).some(Boolean) || fichaPreenchida}
    >
      <label className="block text-xs font-bold text-on-surface-variant">
        Nome completo
        <input required autoFocus type="text" maxLength={120} value={form.nome} onChange={alterar('nome')} className={CAMPO} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-bold text-on-surface-variant">
          Telefone <span className="font-normal">(opcional)</span>
          <input type="tel" maxLength={15} placeholder="(00) 00000-0000" value={form.telefone} onChange={alterar('telefone')} className={CAMPO} />
        </label>
        <label className="block text-xs font-bold text-on-surface-variant">
          CPF <span className="font-normal">(opcional)</span>
          <input type="text" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" value={form.cpf} onChange={alterar('cpf')} className={CAMPO} />
        </label>
      </div>
      <label className="block text-xs font-bold text-on-surface-variant">
        E-mail <span className="font-normal">(opcional)</span>
        <input type="email" maxLength={120} value={form.email} onChange={alterar('email')} className={CAMPO} />
      </label>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/20 px-4 py-3">
        <p className="text-sm text-on-surface">
          Ficha de anamnese{' '}
          {fichaPreenchida
            ? <span className="font-bold text-primary">preenchida</span>
            : <span className={exigirAnamnese ? 'font-bold text-error' : 'text-on-surface-variant'}>{exigirAnamnese ? 'obrigatória' : '(opcional)'}</span>}
        </p>
        <button type="button" onClick={() => setFichaAberta(true)} className="px-3 py-2 rounded-xl border border-outline-variant/30 text-xs font-bold text-primary hover:bg-primary/10">
          {fichaPreenchida ? 'Revisar ficha' : 'Preencher ficha'}
        </button>
      </div>
      {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
    </ModalFormulario>
    {/* Fora do <form> do cadastro: Enter num campo da ficha não envia o cadastro */}
    {fichaAberta && <AnamneseForm data={ficha} onChange={setFicha} onClose={() => setFichaAberta(false)} />}
    </>
  );
}
