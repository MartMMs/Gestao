import { useMemo, useState } from 'react';
import type { ScaleSwapPayload } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { useModal } from '../../../hooks/useModal';
import { dataBR, diaMesBR } from '@shared/agenda';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import type { DiaEscala } from '../../../utils/escalaCalculator';
import type { usePlanejamentoEscala } from '../hooks/usePlanejamentoEscala';
import { retratoDoDia } from '../utils/turnos';
import { diasDaSemana, folgasDaSemana, semanaVizinha, type FolgaDaSemana } from '../utils/folgasDaSemana';

const NOMES_DIA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// Quem está de folga na semana e a troca da folga para outro dia de trabalho da mesma pessoa.
// Só supervisão e administração (o Módulo RH só abre para elas; a API também recusa os demais)
export function FolgasDaEquipe({ planejamento, onSwapScaleDays }: {
  planejamento: ReturnType<typeof usePlanejamentoEscala>;
  onSwapScaleDays?: (payload: ScaleSwapPayload) => Promise<boolean | void> | void;
}) {
  const { activeNonAdminEmployees: equipe, buildScaleForEmployee, ajustesSalvos, setToastMessage, setErrorMessage } = planejamento;
  const { currentUser } = useAuth();
  const podeTrocar = (currentUser?.role === 'supervisor' || currentUser?.role === 'admin') && Boolean(onSwapScaleDays);
  const hoje = getLocalTodayString();
  const [diaDaSemana, setDiaDaSemana] = useState(hoje);
  const [trocando, setTrocando] = useState<FolgaDaSemana | null>(null);
  const [destino, setDestino] = useState('');
  const [salvando, setSalvando] = useState(false);
  useModal(Boolean(trocando), () => { if (!salvando) setTrocando(null); });

  const datas = diasDaSemana(diaDaSemana);
  const segunda = datas[0];
  const porDia = useMemo(() => {
    // A semana pode atravessar a virada do mês: monta a escala dos dois meses envolvidos
    const semana = diasDaSemana(segunda);
    const meses = [...new Set([semana[0].slice(0, 7), semana[6].slice(0, 7)])];
    return folgasDaSemana(equipe, (id) => meses.flatMap((mes) => buildScaleForEmployee(id, { mes })), segunda, hoje);
  }, [equipe, buildScaleForEmployee, segunda, hoje]);

  const retrato = (colaboradorId: string, dia: DiaEscala) => retratoDoDia(colaboradorId, dia, ajustesSalvos);

  const abrirTroca = (folga: FolgaDaSemana) => { setTrocando(folga); setDestino(folga.destinos[0]?.data ?? ''); };

  const confirmarTroca = async () => {
    const diaDestino = trocando?.destinos.find((d) => d.data === destino);
    if (!trocando || !diaDestino || !onSwapScaleDays) return;
    setSalvando(true);
    try {
      const ok = await onSwapScaleDays({
        from: { colaboradorId: trocando.colaboradorId, data: trocando.data, snapshot: retrato(trocando.colaboradorId, trocando.dia) },
        to: { colaboradorId: trocando.colaboradorId, data: destino, snapshot: retrato(trocando.colaboradorId, diaDestino) },
      });
      if (ok === false) return;
      setToastMessage(`Folga de ${trocando.nome} trocada: ${dataBR(trocando.data)} → ${dataBR(destino)}.`);
      setTrocando(null);
    } catch (erro) {
      setErrorMessage(erro instanceof Error ? erro.message : 'Não foi possível trocar a folga.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section aria-labelledby="folgas-titulo" className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 id="folgas-titulo" className="text-base font-bold text-on-surface">Folgas da equipe</h2>
          <p className="text-sm text-on-surface-variant">Quem descansa em cada dia da semana. Folga comum pode ser trocada para outro dia de trabalho da mesma pessoa, na mesma semana.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setDiaDaSemana((d) => semanaVizinha(d, -1))} aria-label="Semana anterior" className="p-2 rounded-xl border border-outline-variant/30 hover:bg-surface-container">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
          </button>
          <span className="text-sm font-bold text-on-surface tabular-nums" aria-live="polite">{dataBR(datas[0])} a {dataBR(datas[6])}</span>
          <button type="button" onClick={() => setDiaDaSemana((d) => semanaVizinha(d, 1))} aria-label="Próxima semana" className="p-2 rounded-xl border border-outline-variant/30 hover:bg-surface-container">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
          </button>
          {datas[0] !== diasDaSemana(hoje)[0] && (
            <button type="button" onClick={() => setDiaDaSemana(hoje)} className="px-3 py-2 rounded-xl text-xs font-bold text-primary hover:bg-surface-container">Esta semana</button>
          )}
        </div>
      </header>

      <ul className="divide-y divide-outline-variant/15">
        {datas.map((data, i) => {
          const folgas = porDia.get(data) ?? [];
          return (
            <li key={data} className={`py-3 grid gap-2 sm:grid-cols-[9rem_1fr] ${data === hoje ? 'bg-primary/5 -mx-3 px-3 rounded-xl' : ''}`}>
              <p className="text-sm font-bold text-on-surface">{NOMES_DIA[i]} <span className="font-normal text-on-surface-variant tabular-nums">{diaMesBR(data)}</span>{data === hoje && <span className="ml-1 text-xs text-primary">(hoje)</span>}</p>
              {folgas.length === 0 ? (
                <p className="text-sm text-on-surface-variant">Ninguém de folga.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {folgas.map((f) => (
                    <li key={f.colaboradorId} className="flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-low pl-3 pr-1 py-1">
                      <span className="text-sm text-on-surface">{f.nome}</span>
                      <span className="text-[11px] font-bold uppercase text-on-surface-variant">{f.rotulo}</span>
                      {podeTrocar && f.trocavel && (
                        <button type="button" onClick={() => abrirTroca(f)} className="px-2 py-1 rounded-lg text-xs font-bold text-primary hover:bg-primary/10">Trocar folga</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {trocando && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) setTrocando(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="troca-folga-titulo" className="bg-surface-container-lowest rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 id="troca-folga-titulo" className="text-lg font-bold text-on-surface">Trocar folga de {trocando.nome}</h3>
            <p className="text-sm text-on-surface-variant">A folga de {NOMES_DIA[datas.indexOf(trocando.data)].toLowerCase()} {dataBR(trocando.data)} passa para o dia escolhido, e esse dia vira dia de trabalho no lugar.</p>
            <label className="block text-xs font-bold text-on-surface-variant">
              Novo dia de folga
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface">
                {trocando.destinos.map((d) => <option key={d.data} value={d.data}>{NOMES_DIA[datas.indexOf(d.data)]} {dataBR(d.data)}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={salvando} onClick={() => setTrocando(null)} className="px-4 py-2 rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container">Cancelar</button>
              <button type="button" disabled={salvando || !destino} onClick={confirmarTroca} className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary disabled:opacity-60">{salvando ? 'Trocando...' : 'Confirmar troca'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
