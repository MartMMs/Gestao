import { useState } from 'react';
import type { DiaEspecial } from '@shared/agenda';
import { formatarDataComDiaSemanaBR } from '@shared/datasBR';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { campo, rotulo } from './estilosHorario';

type Props = {
  especiais: DiaEspecial[];
  // Horário da semana: vira o ponto de partida quando um dia passa de "Fechado" para "Horário especial"
  padrao: { abertura: string; fechamento: string };
  onChange: (especiais: DiaEspecial[]) => void;
};

/** Datas fechadas ou com horário próprio, dentro do cartão de horário de funcionamento (que valida e salva). */
export function DiasEspeciaisEditor({ especiais, padrao, onChange }: Props) {
  const hoje = getLocalTodayString();
  const [novaData, setNovaData] = useState('');
  const mudar = (data: string, mudanca: Partial<DiaEspecial>) =>
    onChange(especiais.map((d) => (d.data === data ? { ...d, ...mudanca } : d)));
  // O min do campo só limita o calendário: digitada no teclado, uma data passada passaria
  const podeAdicionar = Boolean(novaData) && novaData >= hoje && !especiais.some((d) => d.data === novaData);
  const adicionar = () => {
    if (!podeAdicionar) return;
    const novo: DiaEspecial = { data: novaData, fechado: true, abertura: null, fechamento: null, motivo: null };
    onChange([...especiais, novo].sort((a, b) => a.data.localeCompare(b.data)));
    setNovaData('');
  };

  return (
    <fieldset>
      <legend className={rotulo}>Dias especiais</legend>
      <p className="text-[11px] text-on-surface-variant mb-3">
        Feche a casa numa data (ex.: 10/12) ou defina o horário só daquele dia (ex.: 24/12 até 14:00). Vale mesmo num dia da semana fechado.
        O motivo aparece para os clientes no totem: escreva algo que possa ser público (ex.: "Inventário", "Feriado municipal").
      </p>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div>
          <label htmlFor="dia-especial-data" className="block text-[11px] text-on-surface-variant mb-1">Data</label>
          <input id="dia-especial-data" type="date" min={hoje} value={novaData} onChange={(e) => setNovaData(e.target.value)} className={`${campo} w-auto`} />
        </div>
        <button type="button" onClick={adicionar} disabled={!podeAdicionar}
          className="px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider border border-primary text-primary disabled:opacity-50">
          Adicionar dia
        </button>
      </div>
      {novaData && novaData < hoje && <p role="alert" className="text-xs text-error -mt-2 mb-3">Escolha hoje ou uma data futura.</p>}
      {especiais.length > 0 && (
        <ul aria-label="Dias especiais" className="space-y-2">
          {especiais.map((d) => {
            const nome = formatarDataComDiaSemanaBR(d.data);
            return (
              <li key={d.data} className={`flex flex-wrap items-center gap-2 rounded-xl border border-outline-variant/20 p-3 ${d.data < hoje ? 'opacity-60' : ''}`}>
                <span className="text-sm font-semibold text-on-surface min-w-[130px]">{nome}</span>
                <select aria-label={`Situação em ${nome}`} value={d.fechado ? 'fechado' : 'horario'}
                  onChange={(e) => mudar(d.data, e.target.value === 'fechado'
                    ? { fechado: true, abertura: null, fechamento: null }
                    : { fechado: false, abertura: padrao.abertura, fechamento: padrao.fechamento })}
                  className={`${campo} w-auto py-2`}>
                  <option value="fechado">Fechado</option>
                  <option value="horario">Horário especial</option>
                </select>
                {!d.fechado && (
                  <>
                    <input type="time" aria-label={`Abre às, ${nome}`} value={d.abertura ?? ''} onChange={(e) => mudar(d.data, { abertura: e.target.value || null })} className={`${campo} w-auto py-2`} />
                    <span className="text-xs text-on-surface-variant">às</span>
                    <input type="time" aria-label={`Fecha às, ${nome}`} value={d.fechamento ?? ''} onChange={(e) => mudar(d.data, { fechamento: e.target.value || null })} className={`${campo} w-auto py-2`} />
                  </>
                )}
                <input type="text" maxLength={80} placeholder="Motivo público (opcional)" aria-label={`Motivo em ${nome}`} value={d.motivo ?? ''}
                  onChange={(e) => mudar(d.data, { motivo: e.target.value || null })} className={`${campo} flex-1 min-w-[140px] py-2`} />
                <button type="button" aria-label={`Remover ${nome}`} onClick={() => onChange(especiais.filter((x) => x.data !== d.data))}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-error hover:bg-error/10">Remover</button>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
