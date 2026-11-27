import { formatarDataBR } from '@shared/datasBR';
import React, { useState } from 'react';
import { useAuth } from '../../../AuthContext';
import { useMinhaEscala, type MeuDia, type TipoMeuDia } from '../../../api';
import { useModal } from '../../../hooks/useModal';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';

// "Ver minha escala" (colaborador e recepção): só leitura, só a própria pessoa (o servidor usa a sessão)

const VISUAL: Record<TipoMeuDia, { rotulo: string; classe: string }> = {
  trabalho: { rotulo: 'Trabalho', classe: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30' },
  folga: { rotulo: 'Folga', classe: 'bg-surface-container text-on-surface-variant border-outline-variant/30' },
  feriado: { rotulo: 'Feriado', classe: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30' },
  ferias: { rotulo: 'Férias', classe: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 border-sky-500/30' },
  afastamento: { rotulo: 'Afastamento', classe: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30' },
};
const SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const horario = (turno: string | null) => (turno ? turno.replace('-', '–') : 'sem horário definido');
const ddmm = formatarDataBR;
const mesVizinho = (mes: string, delta: number) => {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(ano, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const descreverDia = (dia: MeuDia | null) => {
  if (!dia) return '—';
  if (dia.tipo !== 'trabalho') return dia.tipo === 'feriado' && dia.descricao ? `Feriado · ${dia.descricao}` : VISUAL[dia.tipo].rotulo;
  return `${dia.turnoNome ? `${dia.turnoNome} · ` : ''}${horario(dia.turno)}`;
};

export function MinhaEscalaModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const hoje = getLocalTodayString();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const { data, isLoading, isError } = useMinhaEscala(token, mes, true);
  useModal(true, onClose);

  const [ano, m] = mes.split('-').map(Number);
  const deslocamento = (new Date(Date.UTC(ano, m - 1, 1)).getUTCDay() + 6) % 7; // semana começa na segunda

  return (
    <div className="fixed inset-0 bg-black/55 backdrop-blur-sm z-80 p-0 sm:p-4 flex items-end sm:items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Minha Escala" className="bg-surface-container-low w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-outline-variant/10 shadow-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-headline text-primary">Minha Escala</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        {data && (
          <dl className="grid grid-cols-2 gap-2 mb-4">
            <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/20 p-3">
              <dt className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Turno de hoje</dt>
              <dd className="text-sm font-bold text-on-surface mt-1">{descreverDia(data.resumo.hoje)}</dd>
            </div>
            <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/20 p-3">
              <dt className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">Próxima folga</dt>
              <dd className="text-sm font-bold text-on-surface mt-1">{data.resumo.proximaFolga ? ddmm(data.resumo.proximaFolga) : '—'}</dd>
            </div>
            <div className="col-span-2 text-xs text-on-surface-variant flex flex-wrap justify-between gap-2">
              <span>Amanhã: {descreverDia(data.resumo.amanha)}</span>
              {data.resumo.atualizadaEm && <span>Atualizada em {ddmm(data.resumo.atualizadaEm)}</span>}
            </div>
          </dl>
        )}

        <div className="flex items-center justify-between mb-3">
          <button type="button" onClick={() => setMes(mesVizinho(mes, -1))} aria-label="Mês anterior" className="p-2 rounded-xl hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <p className="text-sm font-bold text-on-surface capitalize" aria-live="polite">{MESES[m - 1]} de {ano}</p>
          <button type="button" onClick={() => setMes(mesVizinho(mes, 1))} aria-label="Próximo mês" className="p-2 rounded-xl hover:bg-surface-container text-on-surface-variant">
            <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        {isLoading && <p className="text-sm text-on-surface-variant">Carregando...</p>}
        {isError && <p role="alert" className="text-sm text-error">Não foi possível carregar sua escala.</p>}
        {data && data.dias.length === 0 && <p className="text-sm text-on-surface-variant">Você não tem escala cadastrada neste mês.</p>}

        {data && data.dias.length > 0 && (
          <>
            {/* Desktop: calendário; celular: lista compacta */}
            <div className="hidden sm:grid grid-cols-7 gap-1" role="grid" aria-label="Calendário do mês">
              {SEMANA.map((s) => <div key={s} className="text-center text-[11px] font-bold uppercase text-on-surface-variant">{s}</div>)}
              {Array.from({ length: deslocamento }, (_, i) => <div key={`v${i}`} />)}
              {data.dias.map((dia) => (
                <div key={dia.data} title={`${ddmm(dia.data)} · ${descreverDia(dia)}`} className={`min-h-16 rounded-lg border p-1 text-[11px] leading-tight ${VISUAL[dia.tipo].classe} ${dia.data === hoje ? 'ring-2 ring-primary' : ''}`}>
                  <span className="font-bold">{Number(dia.data.slice(8))}</span>
                  <span className="block">{dia.tipo === 'trabalho' ? horario(dia.turno) : VISUAL[dia.tipo].rotulo}</span>
                </div>
              ))}
            </div>
            <ul className="sm:hidden divide-y divide-outline-variant/10" aria-label="Dias do mês">
              {data.dias.map((dia) => (
                <li key={dia.data} className={`flex items-center justify-between gap-2 py-2 text-sm ${dia.data === hoje ? 'font-bold' : ''}`}>
                  <span className="text-on-surface">{ddmm(dia.data)} · {SEMANA[(new Date(`${dia.data}T12:00:00Z`).getUTCDay() + 6) % 7]}</span>
                  <span className={`px-2 py-0.5 rounded-lg border text-xs ${VISUAL[dia.tipo].classe}`}>{descreverDia(dia)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="text-xs text-on-surface-variant mt-4">Alterações de escala e folgas são feitas pela supervisão.</p>
        <button type="button" onClick={onClose} className="mt-3 w-full py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-on-primary bg-primary hover:bg-primary-dim transition-colors">
          Fechar
        </button>
      </div>
    </div>
  );
}
