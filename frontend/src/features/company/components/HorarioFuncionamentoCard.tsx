import React, { useEffect, useState } from 'react';
import { lerFuncionamento, NOMES_DIAS_SEMANA, validarFuncionamento, type Funcionamento } from '@shared/agenda';
import { useAuth } from '../../../AuthContext';
import { isApiError, useCompanyConfig, useUpdateCompanyConfig } from '../../../api';
import { CODIGO_FORA_DO_HORARIO } from '@shared/codigosErro';

const DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana começando na segunda
const rotuloDia = (d: number) => NOMES_DIAS_SEMANA[d].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
const campo = 'w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none';
const rotulo = 'block text-[11px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2';

/** Horário de funcionamento da casa (admin e supervisão): vale para a agenda da equipe, o totem e a grade. */
export function HorarioFuncionamentoCard() {
  const { token } = useAuth();
  const { data: config } = useCompanyConfig(token);
  const salvar = useUpdateCompanyConfig(token);
  const [form, setForm] = useState<Funcionamento>(() => lerFuncionamento(config));
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  // Aviso do servidor de que há atendimentos marcados fora do novo horário: salvar de novo confirma
  const [foraDoHorario, setForaDoHorario] = useState<string | null>(null);
  // Horário que o formulário mostrou por último: com edição em andamento, config nova de fora não apaga o que foi digitado
  const [base, setBase] = useState<Funcionamento>(() => lerFuncionamento(config));
  const [mudouFora, setMudouFora] = useState(false);

  const salvo = lerFuncionamento(config);
  const alterado = JSON.stringify(form) !== JSON.stringify(base);
  useEffect(() => {
    if (JSON.stringify(salvo) === JSON.stringify(base)) return;
    if (alterado) { setMudouFora(true); return; }
    setForm(salvo);
    setBase(salvo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const erro = validarFuncionamento(form);
  const editar = (novo: Funcionamento) => { setForm(novo); setForaDoHorario(null); setMensagem(null); };
  const alternarDia = (d: number) => editar({ ...form, dias: form.dias.includes(d) ? form.dias.filter((x) => x !== d) : [...form.dias, d].sort((a, b) => a - b) });
  const descartar = () => { setForm(salvo); setBase(salvo); setMudouFora(false); setForaDoHorario(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (erro || !alterado) return;
    setMensagem(null);
    try {
      await salvar.mutateAsync({
        horaAbertura: form.abertura, horaFechamento: form.fechamento, horaLimiteAgendamento: form.limite, diasFuncionamento: form.dias,
        ...(foraDoHorario ? { confirmarForaDoHorario: true } : {}),
      });
      setBase(form);
      setMudouFora(false);
      setForaDoHorario(null);
      setMensagem({ tipo: 'ok', texto: 'Horário de funcionamento salvo. A agenda e o totem já usam o novo horário.' });
    } catch (err) {
      if (isApiError(err) && err.code === CODIGO_FORA_DO_HORARIO) setForaDoHorario(err.message);
      else setMensagem({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Não foi possível salvar o horário.' });
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-labelledby="horario-funcionamento-titulo" className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm p-6 space-y-5">
      <div>
        <h3 id="horario-funcionamento-titulo" className="text-lg font-headline text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">schedule</span>
          Horário de funcionamento
        </h3>
        <p className="text-xs text-on-surface-variant mt-1">
          Vale para a casa toda: agenda da recepção e dos profissionais, totem de autoatendimento e grade da agenda.
          Atendimentos já marcados não mudam; se algum ficar fora do novo horário, você será avisado antes de salvar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor="horario-abertura" className={rotulo}>Abertura</label>
          <input id="horario-abertura" type="time" required value={form.abertura} onChange={(e) => editar({ ...form, abertura: e.target.value })} className={campo} />
        </div>
        <div>
          <label htmlFor="horario-fechamento" className={rotulo}>Fechamento</label>
          <input id="horario-fechamento" type="time" required value={form.fechamento} onChange={(e) => editar({ ...form, fechamento: e.target.value })} className={campo} />
        </div>
        <div>
          <label htmlFor="horario-limite" className={rotulo}>Último horário para agendar</label>
          <input id="horario-limite" type="time" value={form.limite ?? ''} onChange={(e) => editar({ ...form, limite: e.target.value || null })} className={campo} />
          <p className="text-[11px] text-on-surface-variant mt-1">Em branco: qualquer horário que termine até o fechamento.</p>
        </div>
      </div>

      <fieldset>
        <legend className={rotulo}>Dias de funcionamento</legend>
        <div className="flex flex-wrap gap-2">
          {DIAS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={form.dias.includes(d)}
              aria-label={NOMES_DIAS_SEMANA[d]}
              onClick={() => alternarDia(d)}
              className={`min-w-[52px] px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-colors ${
                form.dias.includes(d) ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-low text-on-surface-variant border-outline-variant/30 hover:text-on-surface'
              }`}
            >
              {rotuloDia(d)}
            </button>
          ))}
        </div>
      </fieldset>

      {alterado && erro && <p role="alert" className="text-xs text-error">{erro}</p>}
      {mudouFora && (
        <p role="alert" className="text-xs text-amber-800 dark:text-amber-300">
          Outra pessoa alterou o horário enquanto você editava. Salve para manter o seu ou{' '}
          <button type="button" onClick={descartar} className="underline font-semibold">use o horário salvo</button>.
        </p>
      )}
      {foraDoHorario && (
        <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {foraDoHorario} Clique em "Salvar mesmo assim" para confirmar.
        </p>
      )}
      {mensagem && (
        <p role={mensagem.tipo === 'erro' ? 'alert' : 'status'} className={`text-xs ${mensagem.tipo === 'erro' ? 'text-error' : 'text-green-700 dark:text-green-400'}`}>{mensagem.texto}</p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={!alterado || Boolean(erro) || salvar.isPending} className="bg-primary text-on-primary px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50">
          {salvar.isPending ? 'Salvando...' : foraDoHorario ? 'Salvar mesmo assim' : !alterado ? 'Nada alterado' : 'Salvar horário'}
        </button>
      </div>
    </form>
  );
}
