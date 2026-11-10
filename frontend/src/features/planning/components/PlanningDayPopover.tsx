import React, { useMemo, useState } from 'react';
import { Employee } from '../../../types';
import { aplicarAjusteEscala, DiaEscala } from '../../../utils/escalaCalculator';
import { analisarInterjornadaEscala, horasDoDia } from '../../../utils/cltValidator';
import { ModalFormulario } from '../../../components/ModalFormulario';
import { TurnoSelect } from './TurnoSelect';
import { VISUAL_CATEGORIA, categoriaDoTurno, formatarHoras, turnoDoDia } from '../utils/turnos';

/** Só o que o supervisor mudou; undefined = manter o que cada dia já tem */
export type AlteracaoDias = { tipo?: DiaEscala['tipo']; turno?: string; descricao?: string };

export interface PlanningDayPopoverProps {
  /** Um dia, ou vários (seleção arrastando ou Shift + clique) */
  dias: DiaEscala[];
  colaborador?: Employee | null;
  /** Escala do colaborador com os meses vizinhos: interjornada e semana na virada do mês */
  escalaContexto: DiaEscala[];
  /** Observação gravada do dia (num dia só); o texto que o sistema gera, como "Feriado: ...", não entra no campo */
  notaSalva?: string;
  scaleByEmployee?: Map<string, DiaEscala[]>;
  onClose: () => void;
  /** Rejeita com a mensagem quando não salva: o modal fica aberto com o erro */
  onSave: (alteracao: AlteracaoDias) => Promise<void>;
}

const TIPOS: { tipo: DiaEscala['tipo']; rotulo: string; icone: string }[] = [
  { tipo: 'trabalho', rotulo: 'Trabalho', icone: 'work' },
  { tipo: 'folga', rotulo: 'Folga', icone: 'event_busy' },
  { tipo: 'fds', rotulo: 'FDS', icone: 'weekend' },
];

const dataBR = (data: string) => data.split('-').reverse().slice(0, 2).join('/');
const dataLonga = (data: string) => new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const inicioDaSemana = (data: string) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const unico = <T,>(valores: T[]) => (new Set(valores).size === 1 ? valores[0] : undefined);

export function PlanningDayPopover({ dias, colaborador, escalaContexto, notaSalva, scaleByEmployee, onClose, onSave }: PlanningDayPopoverProps) {
  const emLote = dias.length > 1;
  // Valor comum aos dias; em lote com dias diferentes fica vazio ("vários") e só muda se o supervisor escolher
  const tipoInicial = unico(dias.map((d) => d.tipo));
  const turnoInicial = unico(dias.map((d) => turnoDoDia(d)));
  const descricaoInicial = emLote ? '' : notaSalva || '';

  const [tipo, setTipo] = useState(tipoInicial);
  // "" = sem turno escolhido: o dia fica com o que tem (inclusive sem turno, quando a agenda aceita o horário da casa)
  const [turno, setTurno] = useState(turnoInicial ?? '');
  const [descricao, setDescricao] = useState(descricaoInicial);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tipoMudou = tipo !== tipoInicial;
  const turnoMudou = tipo === 'trabalho' && turno !== '' && (turno !== turnoInicial || tipoMudou);
  const alteracao: AlteracaoDias = {
    tipo: tipoMudou ? tipo : undefined,
    turno: turnoMudou ? turno : undefined,
    descricao: descricao !== descricaoInicial ? descricao.trim() : undefined,
  };
  const alterado = Object.values(alteracao).some((v) => v !== undefined);

  // A escala como ficaria, para os avisos (mesmas funções da análise CLT do backend)
  const datas = useMemo(() => new Set(dias.map((d) => d.data)), [dias]);
  const proposta = useMemo(() => escalaContexto.map((dia) => {
    if (!datas.has(dia.data)) return dia;
    const tipoFinal = alteracao.tipo ?? dia.tipo;
    return aplicarAjusteEscala(dia, { tipo: tipoFinal, turno: tipoFinal === 'trabalho' ? alteracao.turno ?? turnoDoDia(dia) : undefined });
  }), [alteracao.tipo, alteracao.turno, datas, escalaContexto]);

  const avisosInterjornada = useMemo(() => analisarInterjornadaEscala(proposta).violacoes
    .filter((v) => datas.has(v.dataTurnoAtual) || datas.has(v.dataTurnoAnterior))
    .map((v) => `Descanso de ${formatarHoras(v.descansoHoras)} entre ${dataBR(v.dataTurnoAnterior)} (${v.turnoAnterior}) e ${dataBR(v.dataTurnoAtual)} (${v.turnoAtual}). O mínimo é 11h (CLT, art. 66).`),
  [datas, proposta]);

  // Todas as semanas que a seleção toca, inteiras (inclusive dias do mês vizinho)
  const avisosSemana = useMemo(() => {
    const contrato = Number(colaborador?.cargaHorariaSemanal) > 0 ? Number(colaborador?.cargaHorariaSemanal) : 44;
    const semanas = new Set([...datas].map(inicioDaSemana));
    const horas = new Map<string, number>();
    proposta.forEach((dia) => {
      const semana = inicioDaSemana(dia.data);
      if (semanas.has(semana)) horas.set(semana, (horas.get(semana) ?? 0) + horasDoDia(dia));
    });
    return [...horas].filter(([, total]) => total > contrato)
      .map(([semana, total]) => `Semana de ${dataBR(semana)}: ${formatarHoras(total)}, ${formatarHoras(total - contrato)} acima do contrato de ${contrato}h.`);
  }, [colaborador?.cargaHorariaSemanal, datas, proposta]);

  const horasSelecao = proposta.filter((d) => datas.has(d.data)).reduce((soma, d) => soma + horasDoDia(d), 0);

  // Cobertura no dia, só faz sentido em dia único de trabalho
  const cobertura = useMemo(() => {
    if (emLote || tipo !== 'trabalho' || !scaleByEmployee) return null;
    const categoria = categoriaDoTurno(turno);
    let mesmoTurno = 0;
    let noDia = 0;
    scaleByEmployee.forEach((diasEmp, empId) => {
      if (empId === colaborador?.id) return;
      const dia = diasEmp.find((d) => d.data === dias[0].data);
      if (dia?.tipo !== 'trabalho') return;
      noDia += 1;
      if (categoriaDoTurno(turnoDoDia(dia)) === categoria) mesmoTurno += 1;
    });
    return { categoria, mesmoTurno, noDia };
  }, [colaborador?.id, dias, emLote, scaleByEmployee, tipo, turno]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!alterado || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(alteracao);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setIsSaving(false);
    }
  };

  if (dias.length === 0) return null;
  const titulo = emLote ? `${dataBR(dias[0].data)} a ${dataBR(dias[dias.length - 1].data)}` : dataLonga(dias[0].data);

  return (
    <ModalFormulario
      title={titulo}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={!alterado ? 'Nada alterado' : emLote ? `Aplicar nos ${dias.length} dias` : 'Salvar'}
      submitDisabled={!alterado}
      isSubmitting={isSaving}
      hasUnsavedChanges={alterado}
      infoBanner={
        <p className="-mt-4 mb-4 text-xs text-on-surface-variant">
          {colaborador ? `${colaborador.name} • ${colaborador.tipoEscala || '6x1'} • ${colaborador.cargaHorariaSemanal ?? 44}h/sem • ` : ''}
          {emLote
            ? `${dias.length} dias selecionados. Só o que você mudar será aplicado; o resto de cada dia continua como está.`
            : new Date(`${dias[0].data}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })}
        </p>
      }
    >
      <fieldset>
        <legend className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">
          Status do dia{emLote && tipoInicial === undefined && !tipoMudou ? ' (vários)' : ''}
        </legend>
        <div className="flex bg-surface-container-low p-1 rounded-xl border border-outline-variant/20">
          {TIPOS.map((opcao, indice) => (
            <button
              key={opcao.tipo}
              type="button"
              autoFocus={indice === 0}
              aria-pressed={tipo === opcao.tipo}
              onClick={() => setTipo(opcao.tipo)}
              className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                tipo === opcao.tipo ? 'bg-surface-container-highest text-on-surface shadow-sm border border-outline-variant/30' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{opcao.icone}</span>
              {opcao.rotulo}
            </button>
          ))}
        </div>
      </fieldset>

      {tipo === 'trabalho' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="dia-turno" className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest">
              Turno
            </label>
            <span className="text-[11px] font-medium text-on-surface-variant">
              {/* Horas de trabalho: o turno menos o intervalo mínimo da CLT, a mesma conta dos alertas */}
              {`${formatarHoras(horasSelecao)} de trabalho${emLote ? ' na seleção' : ''} (sem o intervalo)`}
            </span>
          </div>
          <TurnoSelect
            id="dia-turno"
            value={turno}
            onChange={setTurno}
            rotuloVazio={turnoInicial !== undefined ? undefined : emLote && dias.some((d) => turnoDoDia(d)) ? 'Manter o turno de cada dia' : 'Sem turno definido (horário da casa)'}
            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-2 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
          />
        </div>
      )}

      {tipo !== undefined && tipo !== 'trabalho' && (
        <p className="rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] text-primary">info</span>
          O turno deste{emLote ? 's dias' : ' dia'} será removido.
        </p>
      )}

      {(avisosInterjornada.length > 0 || avisosSemana.length > 0) && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">warning</span>
            Atenção à CLT
          </p>
          {[...avisosInterjornada, ...avisosSemana].map((aviso) => <p key={aviso} className="text-[11px]">{aviso}</p>)}
        </div>
      )}

      <div>
        <label htmlFor="dia-observacao" className="block text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">
          Observações (opcional)
        </label>
        <textarea
          id="dia-observacao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={200}
          placeholder={emLote ? 'Deixe em branco para manter a observação de cada dia' : 'Ex.: substituindo fulano, troca autorizada...'}
          className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none resize-none min-h-[72px]"
        />
      </div>

      {cobertura && cobertura.categoria && (
        <p className="text-[11px] text-on-surface-variant flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-primary">groups</span>
          Outros profissionais neste dia: {cobertura.noDia}, sendo {cobertura.mesmoTurno} no turno {VISUAL_CATEGORIA[cobertura.categoria].rotulo.toLowerCase()}.
        </p>
      )}

      {saveError && (
        <p role="alert" className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">{saveError}</p>
      )}
    </ModalFormulario>
  );
}
