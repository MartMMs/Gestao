import React, { useEffect, useState } from 'react';
import { lerFuncionamento, NOMES_DIAS_SEMANA, validarFuncionamento, type DiaEspecial, type Funcionamento } from '@shared/agenda';
import { formatarDataComDiaSemanaBR } from '@shared/datasBR';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
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
  const hoje = getLocalTodayString();
  const [novaData, setNovaData] = useState('');
  const mudarEspecial = (data: string, mudanca: Partial<DiaEspecial>) =>
    editar({ ...form, especiais: form.especiais.map((d) => (d.data === data ? { ...d, ...mudanca } : d)) });
  const adicionarEspecial = () => {
    if (!novaData || form.especiais.some((d) => d.data === novaData)) return;
    const novo: DiaEspecial = { data: novaData, fechado: true, abertura: null, fechamento: null, motivo: null };
    editar({ ...form, especiais: [...form.especiais, novo].sort((a, b) => a.data.localeCompare(b.data)) });
    setNovaData('');
  };
  const descartar = () => { setForm(salvo); setBase(salvo); setMudouFora(false); setForaDoHorario(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (erro || !alterado) return;
    setMensagem(null);
    try {
      await salvar.mutateAsync({
        horaAbertura: form.abertura, horaFechamento: form.fechamento, horaLimiteAgendamento: form.limite, diasFuncionamento: form.dias,
        diasEspeciais: form.especiais,
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

      <fieldset>
        <legend className={rotulo}>Dias especiais</legend>
        <p className="text-[11px] text-on-surface-variant mb-3">
          Feche a casa numa data (ex.: 10/12) ou defina o horário só daquele dia (ex.: 24/12 até 14:00). Vale mesmo num dia da semana fechado.
        </p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div>
            <label htmlFor="dia-especial-data" className="block text-[11px] text-on-surface-variant mb-1">Data</label>
            <input id="dia-especial-data" type="date" min={hoje} value={novaData} onChange={(e) => setNovaData(e.target.value)} className={`${campo} w-auto`} />
          </div>
          <button type="button" onClick={adicionarEspecial} disabled={!novaData || form.especiais.some((d) => d.data === novaData)}
            className="px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider border border-primary text-primary disabled:opacity-50">
            Adicionar dia
          </button>
        </div>
        {form.especiais.length > 0 && (
          <ul aria-label="Dias especiais" className="space-y-2">
            {form.especiais.map((d) => {
              const nome = formatarDataComDiaSemanaBR(d.data);
              return (
                <li key={d.data} className={`flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/20 p-3 ${d.data < hoje ? 'opacity-60' : ''}`}>
                  <span className="text-sm font-semibold text-on-surface min-w-[130px]">{nome}</span>
                  <select aria-label={`Situação em ${nome}`} value={d.fechado ? 'fechado' : 'horario'}
                    onChange={(e) => mudarEspecial(d.data, e.target.value === 'fechado'
                      ? { fechado: true, abertura: null, fechamento: null }
                      : { fechado: false, abertura: form.abertura, fechamento: form.fechamento })}
                    className={`${campo} w-auto py-2`}>
                    <option value="fechado">Fechado</option>
                    <option value="horario">Horário especial</option>
                  </select>
                  {!d.fechado && (
                    <>
                      <input type="time" aria-label={`Abre às, ${nome}`} value={d.abertura ?? ''} onChange={(e) => mudarEspecial(d.data, { abertura: e.target.value || null })} className={`${campo} w-auto py-2`} />
                      <span className="text-xs text-on-surface-variant">às</span>
                      <input type="time" aria-label={`Fecha às, ${nome}`} value={d.fechamento ?? ''} onChange={(e) => mudarEspecial(d.data, { fechamento: e.target.value || null })} className={`${campo} w-auto py-2`} />
                    </>
                  )}
                  <input type="text" maxLength={80} placeholder="Motivo (opcional)" aria-label={`Motivo em ${nome}`} value={d.motivo ?? ''}
                    onChange={(e) => mudarEspecial(d.data, { motivo: e.target.value || null })} className={`${campo} flex-1 min-w-[140px] py-2`} />
                  <button type="button" aria-label={`Remover ${nome}`} onClick={() => editar({ ...form, especiais: form.especiais.filter((x) => x.data !== d.data) })}
                    className="px-2 py-1 rounded-lg text-xs font-bold text-error hover:bg-error/10">Remover</button>
                </li>
              );
            })}
          </ul>
        )}
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
