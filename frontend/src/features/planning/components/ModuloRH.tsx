import { formatarDataBR } from '@shared/datasBR';
import React, { useMemo, useRef, useState } from 'react';
import type { ScaleOverridePayload, ScaleReplicatePayload, ScaleSwapPayload } from '../../../api';
import { FolgasDaEquipe } from './FolgasDaEquipe';
import { diasEntre, periodosDeAusencia, type PeriodoAusencia } from '../utils/ausencias';
import { useRemoverAusencia } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useModal } from '../../../hooks/useModal';
import { horasExtrasNoMes, CARGA_SEMANAL_MAXIMA_HORAS } from '../../../utils/cltValidator';
import type { DiaEscala } from '../../../utils/escalaCalculator';
import type { usePlanejamentoEscala } from '../hooks/usePlanejamentoEscala';
import { analisarMes, formatarHoras } from '../utils/turnos';
import { corrigirViolacoesClt } from '../utils/modelosEscala';
import { baixarCsv, csvHorasPrevistas } from '../utils/horasPrevistasCsv';
import { MOTIVOS_AUSENCIA, ehAusencia } from '@shared/escala';


// Hub do Módulo RH: abas (Escalas, Folgas, Horas Previstas, Férias & Afastamentos) e o painel de conformidade CLT

type Aba = 'escalas' | 'folgas' | 'ponto' | 'ausencias';
const ABAS: Array<{ id: Aba; rotulo: string; icone: string }> = [
  { id: 'escalas', rotulo: 'Escalas', icone: 'calendar_month' },
  { id: 'folgas', rotulo: 'Folgas', icone: 'event_busy' },
  { id: 'ponto', rotulo: 'Horas Previstas', icone: 'schedule' },
  { id: 'ausencias', rotulo: 'Férias e Afastamentos', icone: 'beach_access' },
];

const mesVizinho = (mes: string, delta: number) => {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(ano, m - 1 + delta, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
};

interface ModuloRHProps {
  planejamento: ReturnType<typeof usePlanejamentoEscala>;
  onSaveScaleOverride?: (payload: ScaleOverridePayload) => Promise<boolean | void> | void;
  onReplicateScaleDays?: (payload: ScaleReplicatePayload) => Promise<boolean | void> | void;
  onSwapScaleDays?: (payload: ScaleSwapPayload) => Promise<boolean | void> | void;
  children: React.ReactNode; // Aba de Escalas (a Grade de Escalas)
}

export function ModuloRH({ planejamento, onSaveScaleOverride, onReplicateScaleDays, onSwapScaleDays, children }: ModuloRHProps) {
  const {
    activeNonAdminEmployees: equipe,
    buildScaleForEmployee,
    selectedScaleMonth,
    setSelectedScaleMonth,
    selectedScaleMonthLabel,
    proporAjustes,
    suggestedPlanningKeys,
    setSelectedScaleEmployeeId,
    ajustesSalvos,
    setErrorMessage,
    setToastMessage,
  } = planejamento;
  const [aba, setAba] = useState<Aba>('escalas');
  const [painelAberto, setPainelAberto] = useState(false);
  useModal(painelAberto, () => setPainelAberto(false));

  const prefixoMes = `${selectedScaleMonth}-`;
  // Escala de cada um com os meses vizinhos: as regras da CLT olham a virada do mês (igual ao painel lateral da grade)
  const escalas = useMemo(
    () => new Map(equipe.map((emp) => [emp.id, [-1, 0, 1].flatMap((delta) => buildScaleForEmployee(emp.id, { mes: mesVizinho(selectedScaleMonth, delta) }))])),
    [buildScaleForEmployee, equipe, selectedScaleMonth],
  );
  const analises = useMemo(
    () => equipe.map((emp) => ({ emp, analise: analisarMes(escalas.get(emp.id) || [], prefixoMes, emp.tipoEscala || '6x1') })),
    [equipe, escalas, prefixoMes],
  );
  const conflitos = analises.filter(({ analise }) => !analise.conforme);

  const sugerirCorrecao = (empId: string, tipoEscala?: string) => {
    if (suggestedPlanningKeys.some((chave) => chave.startsWith(`${empId}:`))) {
      setErrorMessage('Já existe uma proposta não gravada para este colaborador. Confirme ou descarte antes de pedir outra.');
      return;
    }
    const ajustes = corrigirViolacoesClt(empId, escalas.get(empId) || [], prefixoMes, tipoEscala);
    if (ajustes.length === 0) {
      setErrorMessage('Não há correção automática para este caso (ex.: média da 12x36). Ajuste os turnos na grade.');
      return;
    }
    proporAjustes(ajustes);
    setSelectedScaleEmployeeId(empId);
    setAba('escalas');
    setPainelAberto(false);
    setToastMessage(`Proposta de ${ajustes.length} folga(s) na grade. Revise e clique em "Confirmar Escala".`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <nav
          role="tablist"
          aria-label="Áreas do Módulo RH"
          onKeyDown={(event) => {
            // Padrão de abas: setas trocam de aba, Home/End vão à primeira/última, e o foco acompanha
            const atual = ABAS.findIndex((a) => a.id === aba);
            const destino = { ArrowRight: atual + 1, ArrowLeft: atual - 1, Home: 0, End: ABAS.length - 1 }[event.key];
            if (destino === undefined) return;
            event.preventDefault();
            const proxima = ABAS[(destino + ABAS.length) % ABAS.length].id;
            setAba(proxima);
            document.getElementById(`rh-aba-${proxima}`)?.focus();
          }}
          className="flex flex-nowrap overflow-x-auto gap-1 bg-surface-container-low p-1 rounded-2xl border border-outline-variant/20 max-w-full">
          {ABAS.map(({ id, rotulo, icone }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`rh-aba-${id}`}
              aria-controls={`rh-painel-${id}`}
              aria-selected={aba === id}
              tabIndex={aba === id ? 0 : -1}
              onClick={() => setAba(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold tracking-wide uppercase whitespace-nowrap transition-all ${aba === id ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:text-primary'}`}
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{icone}</span>
              {rotulo}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setPainelAberto(true)}
          className={`h-11 px-4 rounded-xl text-xs font-bold uppercase tracking-wider border flex items-center gap-2 transition-colors ${conflitos.length > 0 ? 'bg-error/10 text-error border-error/30 hover:bg-error/15' : 'bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:text-primary'}`}
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">gavel</span>
          Verificar Conformidade CLT{conflitos.length > 0 ? ` (${conflitos.length})` : ''}
        </button>
      </div>

      <div role="tabpanel" id="rh-painel-escalas" aria-labelledby="rh-aba-escalas" hidden={aba !== 'escalas'}>{children}</div>
      <div role="tabpanel" id="rh-painel-folgas" aria-labelledby="rh-aba-folgas" hidden={aba !== 'folgas'}>
        {aba === 'folgas' && <FolgasDaEquipe planejamento={planejamento} onSwapScaleDays={onSwapScaleDays} />}
      </div>
      <div role="tabpanel" id="rh-painel-ponto" aria-labelledby="rh-aba-ponto" hidden={aba !== 'ponto'}>
        {aba === 'ponto' && <HorasPrevistas analises={analises} escalas={escalas} prefixoMes={prefixoMes} mes={selectedScaleMonth} mesLabel={selectedScaleMonthLabel} onMes={setSelectedScaleMonth} />}
      </div>
      {/* Sempre montada: trocar de aba não apaga o formulário de ausência em andamento */}
      <div role="tabpanel" id="rh-painel-ausencias" aria-labelledby="rh-aba-ausencias" hidden={aba !== 'ausencias'}>
        <FeriasAfastamentos
          equipe={equipe}
          ajustesSalvos={ajustesSalvos}
          onSaveScaleOverride={onSaveScaleOverride}
          onReplicateScaleDays={onReplicateScaleDays}
          setToastMessage={setToastMessage}
          setErrorMessage={setErrorMessage}
        />
      </div>

      {painelAberto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setPainelAberto(false)}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Conformidade CLT"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md h-full max-h-none bg-surface-container-lowest shadow-2xl flex flex-col"
          >
            <header className="p-5 border-b border-outline-variant/15 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-on-surface">Conformidade CLT</h2>
                <p className="text-xs text-on-surface-variant">{selectedScaleMonthLabel} · {conflitos.length} colaborador(es) com problema</p>
              </div>
              <button type="button" onClick={() => setPainelAberto(false)} aria-label="Fechar" className="p-2 rounded-lg text-on-surface-variant hover:text-primary">
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {conflitos.length === 0 && <p className="text-sm text-on-surface-variant">Nenhuma violação na escala deste mês.</p>}
              {conflitos.map(({ emp, analise }) => (
                <article key={emp.id} className="rounded-xl border border-error/25 bg-error/5 p-4 space-y-2">
                  <h3 className="text-sm font-bold text-on-surface">{emp.name}{emp.role === 'supervisor' ? ' · Supervisor' : ''}</h3>
                  <ul className="text-xs text-on-surface-variant list-disc pl-4 space-y-1">
                    {analise.alertas.map((alerta) => <li key={alerta}>{alerta}</li>)}
                  </ul>
                  <button
                    type="button"
                    onClick={() => sugerirCorrecao(emp.id, emp.tipoEscala || '6x1')}
                    className="h-9 px-3 rounded-lg bg-primary text-on-primary text-[11px] font-bold uppercase tracking-wider hover:bg-primary-dim"
                  >
                    Propor folgas na grade
                  </button>
                  <p className="text-[11px] text-on-surface-variant">Nada é gravado: as folgas aparecem como proposta na grade até você clicar em "Confirmar Escala".</p>
                </article>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// Horas previstas pela escala do mês: normais até 44h por semana, o que passa disso é extra
function HorasPrevistas({ analises, escalas, prefixoMes, mes, mesLabel, onMes }: {
  analises: Array<{ emp: { id: string; name: string; cargo?: string }; analise: ReturnType<typeof analisarMes> }>;
  escalas: Map<string, DiaEscala[]>;
  prefixoMes: string;
  mes: string;
  mesLabel: string;
  onMes: (mes: string) => void; // o mesmo mês da grade: trocar aqui troca no módulo todo
}) {
  const linhas = analises.map(({ emp, analise }) => {
    const extras = horasExtrasNoMes(escalas.get(emp.id) || [], prefixoMes);
    return { emp, dias: analise.diasTrabalhados, semTurno: analise.diasSemTurno, total: analise.horasMes, normais: analise.horasMes - extras, extras };
  });

  return (
    <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm overflow-hidden">
      <header className="p-4 border-b border-outline-variant/15 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-on-surface">Horas Previstas · {mesLabel}</h2>
          <p className="text-xs text-on-surface-variant">Horas previstas pela escala (sem marcação de ponto). Extra = o que passa de {CARGA_SEMANAL_MAXIMA_HORAS}h na semana.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="horas-previstas-mes">Mês</label>
          <input id="horas-previstas-mes" type="month" value={mes} onChange={(e) => e.target.value && onMes(e.target.value)} className="h-10 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface" />
          <button
            type="button"
            onClick={() => baixarCsv(csvHorasPrevistas(linhas.map(({ emp, ...l }) => ({ nome: emp.name, cargo: emp.cargo, ...l })), mesLabel), `horas-previstas-${mes}.csv`)}
            className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-wider hover:bg-primary-dim flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span> Exportar CSV
          </button>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm [&_td]:align-top">
          <thead className="text-[11px] uppercase tracking-wider text-on-surface-variant bg-surface-container-low">
            <tr>
              <th scope="col" className="text-left px-4 py-2">Colaborador</th>
              <th scope="col" className="text-right px-4 py-2">Dias</th>
              <th scope="col" className="text-right px-4 py-2">Horas normais</th>
              <th scope="col" className="text-right px-4 py-2">Horas extras</th>
              <th scope="col" className="text-right px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ emp, dias, semTurno, total, normais, extras }) => (
              <tr key={emp.id} className="border-t border-outline-variant/10">
                <td className="px-4 py-2 text-on-surface">{emp.name}<span className="block text-[11px] text-on-surface-variant">{emp.cargo || '—'}</span></td>
                <td className="px-4 py-2 text-right">{dias}{semTurno > 0 && <span className="block text-[11px] whitespace-nowrap text-amber-700 dark:text-amber-400">{semTurno} sem turno, fora das horas</span>}</td>
                <td className="px-4 py-2 text-right">{formatarHoras(normais)}</td>
                <td className={`px-4 py-2 text-right ${extras > 0 ? 'text-error font-bold' : ''}`}>{formatarHoras(extras)}</td>
                <td className="px-4 py-2 text-right font-bold">{formatarHoras(total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Férias e afastamentos viram folga com o motivo na descrição: a Grade de Escalas já mostra o dia como bloqueado
function FeriasAfastamentos({ equipe, ajustesSalvos, onSaveScaleOverride, onReplicateScaleDays, setToastMessage, setErrorMessage }: {
  equipe: Array<{ id: string; name: string }>;
  ajustesSalvos: Map<string, ScaleOverridePayload>;
  onSaveScaleOverride?: ModuloRHProps['onSaveScaleOverride'];
  onReplicateScaleDays?: ModuloRHProps['onReplicateScaleDays'];
  setToastMessage: (mensagem: string | null) => void;
  setErrorMessage: (mensagem: string | null) => void;
}) {
  const [colaboradorId, setColaboradorId] = useState('');
  const [motivo, setMotivo] = useState<(typeof MOTIVOS_AUSENCIA)[number]>('Férias');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [salvando, setSalvando] = useState(false);
  // Trava síncrona: o estado só muda na próxima renderização e o clique duplo gravava o período duas vezes
  const enviandoRef = useRef(false);
  const podeRegistrar = Boolean(onSaveScaleOverride && onReplicateScaleDays);
  const { token } = useAuth();
  const removerAusencia = useRemoverAusencia(token);
  const [paraExcluir, setParaExcluir] = useState<PeriodoAusencia | null>(null);

  const periodos = useMemo(
    () => periodosDeAusencia(ajustesSalvos.values(), new Map(equipe.map((emp) => [emp.id, emp.name]))),
    [ajustesSalvos, equipe],
  );

  const registrar = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!colaboradorId || !inicio || !fim || fim < inicio) {
      setErrorMessage('Escolha o colaborador e um período válido (o fim não pode ser antes do início).');
      return;
    }
    const datas = diasEntre(inicio, fim);
    if (datas.length > 63) {
      setErrorMessage('Registre no máximo 63 dias por vez.');
      return;
    }
    if (!onSaveScaleOverride || !onReplicateScaleDays || enviandoRef.current) return;
    enviandoRef.current = true;
    setSalvando(true);
    const pelaMetade = `Só ${formatarDataBR(inicio)} foi registrado; os outros dias do período não foram gravados. Clique em Registrar de novo para completar.`;
    let primeiroGravado = false;
    try {
      // Grava o primeiro dia e replica para o resto do período numa transação só no servidor
      if ((await onSaveScaleOverride({ colaboradorId, data: inicio, tipo: 'folga', descricao: motivo })) === false) return;
      primeiroGravado = true;
      if (datas.length > 1 && (await onReplicateScaleDays({ colaboradorId, data: inicio, targetDates: datas.slice(1) })) === false) {
        // O primeiro dia já foi gravado: quem registra precisa saber que o período ficou pela metade
        setErrorMessage(pelaMetade);
        return;
      }
      setToastMessage(`${motivo} registrado de ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}.`);
      setInicio('');
      setFim('');
    } catch (error) {
      const motivoErro = error instanceof Error ? error.message : 'Não foi possível registrar o período.';
      setErrorMessage(primeiroGravado && datas.length > 1 ? `${motivoErro} ${pelaMetade}` : motivoErro);
    } finally {
      enviandoRef.current = false;
      setSalvando(false);
    }
  };

  const campo = 'w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface';
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[22rem_1fr] gap-4">
      <form onSubmit={registrar} className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm p-4 space-y-3">
        <h2 className="text-base font-bold text-on-surface">Registrar ausência</h2>
        <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
          Colaborador
          <select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} className={`${campo} mt-1`} required>
            <option value="">Selecione</option>
            {[...equipe].sort((a, b) => a.name.localeCompare(b.name)).map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </label>
        <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as typeof motivo)} className={`${campo} mt-1`}>
            {MOTIVOS_AUSENCIA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
            Início
            <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={`${campo} mt-1`} required />
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
            Fim
            <input type="date" value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} className={`${campo} mt-1`} required />
          </label>
        </div>
        {!podeRegistrar && <p role="status" className="text-xs text-on-surface-variant">Só a supervisão registra férias e afastamentos.</p>}
        <button type="submit" disabled={salvando || !podeRegistrar} className="w-full h-11 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-wider hover:bg-primary-dim disabled:opacity-60">
          {salvando ? 'Registrando...' : 'Registrar'}
        </button>
      </form>

      <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm p-4">
        <h2 className="text-base font-bold text-on-surface mb-3">Períodos registrados</h2>
        {periodos.length === 0 && <p className="text-sm text-on-surface-variant">Nenhuma férias ou afastamento registrado.</p>}
        {periodos.length > 0 && (
          <p className="text-[11px] text-on-surface-variant mb-2">Lançou errado? Use Excluir: os dias do período voltam ao rodízio normal da escala.</p>
        )}
        <ul className="divide-y divide-outline-variant/10">
          {periodos.map((p) => (
            <li key={`${p.id}:${p.inicio}`} className="py-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-on-surface">{p.nome}</span>
              <span className="text-on-surface-variant">{p.motivo} · {formatarDataBR(p.inicio)}{p.fim !== p.inicio ? ` a ${formatarDataBR(p.fim)}` : ''}</span>
              <button type="button" onClick={() => setParaExcluir(p)} aria-label={`Excluir ${p.motivo} de ${p.nome}`} className="shrink-0 px-2 py-1 rounded-lg text-xs font-bold text-error hover:bg-error/10">Excluir</button>
            </li>
          ))}
        </ul>
      </section>
      <ConfirmDialog
        open={Boolean(paraExcluir)}
        title={paraExcluir ? `Excluir ${paraExcluir.motivo.toLowerCase()} de ${paraExcluir.nome}?` : ''}
        description={paraExcluir ? `${formatarDataBR(paraExcluir.inicio)}${paraExcluir.fim !== paraExcluir.inicio ? ` a ${formatarDataBR(paraExcluir.fim)}` : ''}: os dias voltam ao rodízio normal da escala.` : ''}
        confirmLabel="Excluir"
        confirmingLabel="Excluindo..."
        cancelLabel="Manter"
        icon="delete"
        isSubmitting={removerAusencia.isPending}
        onClose={() => { if (!removerAusencia.isPending) setParaExcluir(null); }}
        onConfirm={async () => {
          if (!paraExcluir) return;
          try {
            await removerAusencia.mutateAsync({ colaboradorId: paraExcluir.id, inicio: paraExcluir.inicio, fim: paraExcluir.fim, motivo: paraExcluir.motivo });
            setToastMessage(`${paraExcluir.motivo} de ${paraExcluir.nome} excluído.`);
          } catch (erro) {
            setErrorMessage(erro instanceof Error ? erro.message : 'Não foi possível excluir.');
          } finally {
            setParaExcluir(null);
          }
        }}
      />
    </div>
  );
}
