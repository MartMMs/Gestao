import React, { useState } from 'react';
import { Employee } from '../../../types';
import type { ScaleSwapPayload } from '../../../api';
import type { DiaEscala } from '../../../utils/escalaCalculator';
import { ModalFormulario } from '../../../components/ModalFormulario';

interface FolgasDoDiaProps {
  employees: Employee[];
  scaleByEmployee: Map<string, DiaEscala[]>;
  // Mês da grade (YYYY-MM): a escala calculada só cobre esse mês
  mes: string;
  hoje: string;
  onSwapScaleDays?: (payload: ScaleSwapPayload) => Promise<boolean | void> | void;
  setToastMessage: (mensagem: string | null) => void;
}

const formatarDia = (data: string) => new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const instantaneo = (dia: DiaEscala) => ({ tipo: dia.tipo, turno: dia.tipo === 'trabalho' ? dia.turno : undefined, descricao: dia.descricao });

/**
 * Quem está de folga num dia do mês da grade e, para cada um, "Mudar folga": a folga vai para outro dia de trabalho
 * do mesmo mês e aquele dia vira de trabalho (POST /escala/swap, só supervisão e administração).
 */
export function FolgasDoDia({ employees, scaleByEmployee, mes, hoje, onSwapScaleDays, setToastMessage }: FolgasDoDiaProps) {
  const [dataEscolhida, setDataEscolhida] = useState(hoje);
  const [mudando, setMudando] = useState<{ employee: Employee; dia: DiaEscala } | null>(null);
  const [novoDia, setNovoDia] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoData, setAvisoData] = useState<string | null>(null);

  // Ao trocar o mês da grade, mostra hoje (se for o mês) ou o dia 1
  const data = dataEscolhida.startsWith(`${mes}-`) ? dataEscolhida : (hoje.startsWith(`${mes}-`) ? hoje : `${mes}-01`);
  const [ano, numeroMes] = mes.split('-').map(Number);
  const ultimoDia = `${mes}-${String(new Date(ano, numeroMes, 0).getDate()).padStart(2, '0')}`;

  const deFolga = employees
    .map((employee) => ({ employee, dia: scaleByEmployee.get(employee.id)?.find((d) => d.data === data) }))
    .filter((item): item is { employee: Employee; dia: DiaEscala } => !!item.dia && item.dia.tipo !== 'trabalho');

  const diasDeTrabalho = mudando
    ? (scaleByEmployee.get(mudando.employee.id) ?? []).filter((d) => d.tipo === 'trabalho' && d.data >= hoje)
    : [];

  const abrir = (item: { employee: Employee; dia: DiaEscala }) => {
    setMudando(item);
    setNovoDia('');
    setErro(null);
  };

  const salvar = async (event: React.FormEvent) => {
    event.preventDefault();
    const destino = diasDeTrabalho.find((d) => d.data === novoDia);
    if (!mudando || !destino || !onSwapScaleDays) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSwapScaleDays({
        from: { colaboradorId: mudando.employee.id, data: mudando.dia.data, snapshot: instantaneo(mudando.dia) },
        to: { colaboradorId: mudando.employee.id, data: destino.data, snapshot: instantaneo(destino) },
      });
      setToastMessage(`Folga de ${mudando.employee.name} mudada para ${formatarDia(destino.data)}.`);
      setMudando(null);
    } catch (error) {
      // Não fecha: a escala não mudou no servidor e a pessoa pode tentar outro dia
      setErro(error instanceof Error ? error.message : 'Não foi possível mudar a folga.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section aria-labelledby="folgas-do-dia-titulo" className="bg-surface-container p-5 rounded-3xl border border-outline-variant/10 shadow-sm mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 id="folgas-do-dia-titulo" className="text-lg font-headline text-on-surface">De folga no dia</h2>
          <p className="text-xs text-on-surface-variant">{deFolga.length === 0 ? 'Ninguém de folga.' : `${deFolga.length} profissional(is) de folga.`}</p>
        </div>
        <label className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
          Dia
          <input
            type="date"
            value={data}
            min={`${mes}-01`}
            max={ultimoDia}
            onChange={(event) => {
              const valor = event.target.value;
              if (!valor) return;
              // A escala calculada só cobre o mês da grade: explica em vez de voltar para hoje calado
              if (!valor.startsWith(`${mes}-`)) {
                setAvisoData(`Escolha um dia entre ${formatarDia(`${mes}-01`)} e ${formatarDia(ultimoDia)}. Para outro mês, mude o mês da grade abaixo.`);
                return;
              }
              setAvisoData(null);
              setDataEscolhida(valor);
            }}
            // Escolher de novo o dia que já está no campo não dispara onChange: o aviso sai ao deixar o campo
            onBlur={() => setAvisoData(null)}
            aria-describedby={avisoData ? 'folgas-aviso-data' : undefined}
            className="block mt-1 h-10 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface normal-case tracking-normal font-normal"
          />
        </label>
      </div>

      {avisoData && <p id="folgas-aviso-data" role="alert" className="mb-3 text-sm text-error">{avisoData}</p>}

      {deFolga.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {deFolga.map(({ employee, dia }) => (
            <li key={employee.id} className="flex items-center justify-between gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container-low px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface truncate">{employee.name}</p>
                <p className="text-xs text-on-surface-variant truncate">{dia.tipo === 'fds' ? 'Fim de semana' : 'Folga'}{employee.cargo ? ` · ${employee.cargo}` : ''}</p>
              </div>
              {/* Folga que já passou é histórico: não muda */}
              {onSwapScaleDays && dia.data >= hoje && (
                <button
                  type="button"
                  onClick={() => abrir({ employee, dia })}
                  className="shrink-0 px-3 py-2 rounded-xl border border-outline-variant/20 text-xs font-bold text-primary hover:bg-primary/10"
                >
                  Mudar folga
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mudando && (
        <ModalFormulario
          title="Mudar folga"
          onClose={() => setMudando(null)}
          onSubmit={salvar}
          submitLabel="Mudar folga"
          submittingLabel="Salvando..."
          isSubmitting={salvando}
          submitDisabled={!novoDia}
          hasUnsavedChanges={!!novoDia}
        >
          <p className="text-sm text-on-surface">
            <strong>{mudando.employee.name}</strong> está de folga em <strong>{formatarDia(mudando.dia.data)}</strong>.
            Escolha o novo dia de folga; {formatarDia(mudando.dia.data)} vira dia de trabalho.
          </p>
          <label className="block text-xs font-bold text-on-surface-variant">
            Novo dia de folga
            <select
              value={novoDia}
              onChange={(event) => setNovoDia(event.target.value)}
              className="mt-1 w-full h-11 px-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface font-normal"
            >
              <option value="">Selecione um dia de trabalho</option>
              {diasDeTrabalho.map((d) => (
                <option key={d.data} value={d.data}>{formatarDia(d.data)}{d.turno ? ` (${d.turno})` : ''}</option>
              ))}
            </select>
          </label>
          {diasDeTrabalho.length === 0 && <p className="text-xs text-on-surface-variant">Não há dias de trabalho a partir de hoje neste mês. Mude o mês da grade.</p>}
          {erro && <p role="alert" className="text-sm text-error">{erro}</p>}
        </ModalFormulario>
      )}
    </section>
  );
}
