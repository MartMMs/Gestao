import React, { useRef, useState } from 'react';
import { horarioParaMinutos } from '@shared/agenda';
import { CARGA_SEMANAL_MAXIMA_HORAS } from '@shared/clt';
import { useAddTurno, useDeleteTurno, useTurnos } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { ConfirmDialog } from '../../../components/ConfirmDialog';

// Sub-aba "Regras e Turnos" da Equipe: as regras que a escala segue (só leitura, as mesmas que o servidor aplica)
// e o cadastro de turnos padrão (as opções ao editar um dia da escala)

const REGRAS_ESCALA: Array<{ titulo: string; texto: string }> = [
  { titulo: 'Escala 6x1', texto: 'Seis dias de trabalho e uma folga comum por semana (de segunda a domingo).' },
  { titulo: 'Escala 5x1', texto: 'Cinco dias de trabalho e um dia de folga, em rodízio.' },
  { titulo: 'Escala 5x2', texto: 'Cinco dias de trabalho e dois dias livres na semana, em quaisquer dias.' },
  { titulo: 'Escala 12x36', texto: 'Doze horas de trabalho seguidas de trinta e seis horas de descanso.' },
  { titulo: 'Rotativo', texto: 'Revezamento entre três turnos ao longo dos dias.' },
  { titulo: 'Limite semanal', texto: `No máximo ${CARGA_SEMANAL_MAXIMA_HORAS} horas por semana; acima disso o RH mostra como hora extra.` },
  { titulo: 'Feriados e ausências', texto: 'Feriados, férias, atestados e afastamentos do RH não contam como a folga da semana.' },
  { titulo: 'Horário de cada um', texto: 'O horário de trabalho do cadastro vale nos dias de trabalho; o ajuste feito num dia específico tem prioridade.' },
];

export function RegrasETurnosTab({ setToastMessage, setErrorMessage }: {
  setToastMessage: (msg: string | null) => void;
  setErrorMessage: (msg: string | null) => void;
}) {
  const { token } = useAuth();
  const { data: turnos = [] } = useTurnos(token);
  const { mutateAsync: criarTurno, isPending: criandoTurno } = useAddTurno(token);
  const { mutateAsync: excluirTurno, isPending: excluindoTurno } = useDeleteTurno(token);
  const [turnoParaExcluir, setTurnoParaExcluir] = useState<{ id: string; nome: string } | null>(null);
  // Trava síncrona: o isPending só chega no próximo render, tarde para segurar um duplo clique
  const enviandoTurno = useRef(false);
  const [novoTurnoNome, setNovoTurnoNome] = useState('');
  const [novoTurnoInicio, setNovoTurnoInicio] = useState('08:00');
  const [novoTurnoFim, setNovoTurnoFim] = useState('18:00');

  const handleAddTurno = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoTurno.current) return;
    enviandoTurno.current = true;
    try {
      await criarTurno({ nome: novoTurnoNome.trim(), inicio: novoTurnoInicio, fim: novoTurnoFim });
      setNovoTurnoNome('');
      setToastMessage('Turno adicionado.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível criar o turno.');
    } finally {
      enviandoTurno.current = false;
    }
  };

  const confirmarExclusaoTurno = async () => {
    if (!turnoParaExcluir || enviandoTurno.current) return;
    enviandoTurno.current = true;
    try {
      await excluirTurno(turnoParaExcluir.id);
      setToastMessage(`Turno "${turnoParaExcluir.nome}" excluído.`);
      setTurnoParaExcluir(null);
    } catch (error) {
      setTurnoParaExcluir(null);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir o turno.');
    } finally {
      enviandoTurno.current = false;
    }
  };

  // Duração em horas; fim antes do início = turno que vira a noite
  const duracaoTurno = (inicio: string, fim: string) => {
    const minutos = (horarioParaMinutos(fim) - horarioParaMinutos(inicio) + 1440) % 1440;
    return `${Math.floor(minutos / 60)}h${minutos % 60 ? String(minutos % 60).padStart(2, '0') : ''}`;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-start">
      <section aria-labelledby="regras-titulo" className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm space-y-4">
        <header>
          <h3 id="regras-titulo" className="text-lg font-headline text-on-surface">Regras da escala</h3>
          <p className="text-sm text-on-surface-variant">O sistema confere estas regras ao montar e ao trocar a escala.</p>
        </header>
        <dl className="space-y-3">
          {REGRAS_ESCALA.map((r) => (
            <div key={r.titulo} className="rounded-xl bg-surface-container-low px-4 py-3">
              <dt className="text-sm font-bold text-on-surface">{r.titulo}</dt>
              <dd className="text-sm text-on-surface-variant">{r.texto}</dd>
            </div>
          ))}
        </dl>
      </section>

    <section aria-labelledby="turnos-titulo" className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm space-y-6">
      <header>
        <h3 id="turnos-titulo" className="text-lg font-headline text-on-surface">Turnos padrão</h3>
        <p className="text-sm text-on-surface-variant">Aparecem como opções ao editar um dia da escala e na edição em lote. Excluir um turno não muda dias já marcados.</p>
      </header>

      <form onSubmit={handleAddTurno} className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
        <label className="text-xs font-bold text-on-surface-variant">
          Nome
          <input type="text" value={novoTurnoNome} onChange={e => setNovoTurnoNome(e.target.value)} placeholder="Ex.: Madrugada" maxLength={40} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
        </label>
        <label className="text-xs font-bold text-on-surface-variant">
          Início
          <input type="time" value={novoTurnoInicio} onChange={e => setNovoTurnoInicio(e.target.value)} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
        </label>
        <label className="text-xs font-bold text-on-surface-variant">
          Fim
          <input type="time" value={novoTurnoFim} onChange={e => setNovoTurnoFim(e.target.value)} required className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-normal text-on-surface focus:ring-1 focus:ring-primary outline-none" />
        </label>
        <button type="submit" disabled={criandoTurno} className="h-11 px-5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary-dim disabled:opacity-60">
          {criandoTurno ? 'Salvando...' : 'Adicionar'}
        </button>
      </form>

      {turnos.length === 0 ? (
        <p className="text-sm text-on-surface-variant">Nenhum turno cadastrado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-on-surface-variant border-b border-outline-variant/20">
              <th scope="col" className="py-2 font-bold">Nome</th>
              <th scope="col" className="py-2 font-bold">Horário</th>
              <th scope="col" className="py-2 font-bold">Duração</th>
              <th scope="col" className="py-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {turnos.map(turno => (
              <tr key={turno.id} className="border-b border-outline-variant/10 last:border-0">
                <td className="py-3 font-bold text-on-surface">{turno.nome}</td>
                <td className="py-3 tabular-nums text-on-surface">{turno.inicio} – {turno.fim}{turno.fim < turno.inicio ? ' (dia seguinte)' : ''}</td>
                <td className="py-3 tabular-nums text-on-surface-variant">{duracaoTurno(turno.inicio, turno.fim)}</td>
                <td className="py-3 text-right">
                  <button type="button" onClick={() => setTurnoParaExcluir({ id: turno.id, nome: turno.nome })} aria-label={`Excluir turno ${turno.nome}`} className="p-2 rounded-full text-on-surface-variant hover:text-error hover:bg-error/10">
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>

    <ConfirmDialog
      open={Boolean(turnoParaExcluir)}
      title={`Excluir o turno ${turnoParaExcluir?.nome ?? ''}?`}
      description="Ele some das opções da escala. Dias já marcados com esse horário não mudam."
      confirmLabel="Excluir"
      confirmingLabel="Excluindo..."
      cancelLabel="Manter turno"
      icon="delete"
      isSubmitting={excluindoTurno}
      onClose={() => { if (!excluindoTurno) setTurnoParaExcluir(null); }}
      onConfirm={confirmarExclusaoTurno}
    />
    </div>
  );
}
