import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Employee, TurnoSwapRequest } from '../../../types';
import type { ScaleOverridePayload } from '../../../api';
import { aplicarAjusteEscala, type DiaEscala } from '../../../utils/escalaCalculator';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { CalendarioEscala } from './CalendarioEscala';
import { PlanningDayPopover, type AlteracaoDias } from './PlanningDayPopover';
import { trabalhoAntesDeFolga, turnoDoDia } from '../utils/turnos';
import { folgaAcimaDoLimite, mensagemFolgaAcimaDoLimite } from '@shared/escala';
import { preencher12x36, repetirMesAnterior } from '../utils/modelosEscala';
import { PlanningEmployeeSidebar } from './PlanningEmployeeSidebar';
import { TimelineGantt } from './TimelineGantt';
import { FolgasDoDia } from './FolgasDoDia';
import { TurnoSelect } from './TurnoSelect';
import { isTeamMember } from '../../../utils/formatters';
import { confirmarSaida, useAlterado, useModal } from '../../../hooks/useModal';
import type { usePlanejamentoEscala } from '../hooks/usePlanejamentoEscala';
import type { SupervisorViewProps } from '../../../components/SupervisorView';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type AlertaClt = { id: string; nome: string; conforme: boolean; resumo: string[] };
type TrocaDias = { fromEmp: string; fromDate: string; toEmp: string; toDate: string };
// Ação da grade que grava na hora: só roda depois do "sim" no ConfirmDialog
type AcaoPendente = { titulo: string; descricao: string; confirmLabel: string; executar: () => void };
type Modelo = { titulo: string; descricao: string; aviso?: string; ajustes: ScaleOverridePayload[] };

const mesVizinho = (mes: string, delta: number) => {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(ano, m - 1 + delta, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
};
const dataBR = (data: string) => data.split('-').reverse().slice(0, 2).join('/');

// Estado e ações vêm do hook usePlanejamentoEscala (via SupervisorView), mais as ações da API
type EstadoPlanejamento = ReturnType<typeof usePlanejamentoEscala>;
interface SupervisorPlanejamentoTabProps
  extends EstadoPlanejamento,
    Pick<SupervisorViewProps, 'employees' | 'appointments' | 'onSaveScaleOverride' | 'onSwapScaleDays' | 'onReplicateScaleDays'> {
  setToastMessage: (mensagem: string | null) => void;
  setShowTopAlerts: Setter<boolean>;
  visibleCltToastAlerts: AlertaClt[];
  pendingTurnoSwapRequests: TurnoSwapRequest[];
  setDismissedCltAlertIds: Setter<Record<string, boolean>>;
  selectedScaleCalendar: { year: number; month: number; dias: DiaEscala[] };
  setPlanningOverrides: Setter<Record<string, ScaleOverridePayload>>;
  planningOverridesList: ScaleOverridePayload[];
  buildScaleForEmployee: (employeeId: string, options?: { tipoEscala?: Employee['tipoEscala']; folgasDomingoNoMes?: number; mes?: string }) => DiaEscala[];
  filteredScaleGeneratorEmployees: Employee[];
  setScaleGeneratorSundayOffs: Setter<number>;
}

export function SupervisorPlanejamentoTab(props: SupervisorPlanejamentoTabProps) {
  const {
    employees,
    appointments,
    filterRole,
    setFilterRole,
    changeScaleMonthBy,
    openPlanningMonthPicker,
    selectedScaleMonthLabel,
    planningMonthInputRef,
    selectedScaleMonth,
    setSelectedScaleMonth,
    planningViewMode,
    setPlanningViewMode,
    employeeSearchTerm,
    setEmployeeSearchTerm,
    filterStatus,
    setFilterStatus,
    planningDateScope,
    setPlanningDateScope,
    planningWeekIndex,
    setPlanningWeekIndex,
    planningWeekOptions,
    planningEmployeeFilter,
    setPlanningEmployeeFilter,
    planningShiftFilter,
    setPlanningShiftFilter,
    planningWorkloadFilter,
    setPlanningWorkloadFilter,
    planningVisibleDayRange,
    handleTogglePlanningEditMode,
    isPlanningEditMode,
    handleOpenScaleGenerator,
    handleSuggestAutomaticScale,
    suggestedPlanningKeys,
    handleConfirmSuggestedScale,
    handleDiscardSuggestedScale,
    proporAjustes,
    setSuggestedPlanningKeys,
    ajustesSalvos,
    planningScaleType,
    planningSundayOffs,
    todayStr,
    isSavingPlanning,
    showTopAlerts,
    setShowTopAlerts,
    visibleCltToastAlerts,
    pendingTurnoSwapRequests,
    handleUpdateSwapStatus,
    updatingSwapId,
    setErrorMessage,
    setDismissedCltAlertIds,
    selectedScaleEmployee,
    selectedScaleCalendar,
    setSelectedPlanningEmployeeId,
    setIsPopoverOpen,
    onSwapScaleDays,
    setPlanningOverrides,
    setToastMessage,
    timelineEmployees,
    handleQuickToggleTimelineDay,
    handleQuickSetTimelineDay,
    planningOverridesList,
    buildScaleForEmployee,
    onReplicateScaleDays,
    planningCoverageTarget,
    isPopoverOpen,
    selectedPlanningEmployeeId,
    onSaveScaleOverride,
    isScaleGeneratorOpen,
    setIsScaleGeneratorOpen,
    filteredScaleGeneratorEmployees,
    scaleGeneratorSearch,
    setScaleGeneratorSearch,
    scaleGeneratorEmployeeId,
    setScaleGeneratorEmployeeId,
    scaleGeneratorMonth,
    setScaleGeneratorMonth,
    scaleGeneratorType,
    setScaleGeneratorType,
    scaleGeneratorSundayOffs,
    setScaleGeneratorSundayOffs,
    scaleGeneratorCoverageTarget,
    setScaleGeneratorCoverageTarget,
    scaleGeneratorSundayFrequency,
    setScaleGeneratorSundayFrequency,
    handleGenerateScale,
    setSelectedScaleEmployeeId,
  } = props;

  // Estados da Edição em Lote (Bulk Edit) e Drag-to-Select no Calendário
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchTargetDate, setBatchTargetDate] = useState<string>('');
  const [batchShiftType, setBatchShiftType] = useState<'trabalho' | 'folga' | 'fds'>('trabalho');
  const [batchShiftTurno, setBatchShiftTurno] = useState<string>('08:00-18:00');
  const [batchShiftDescricao, setBatchShiftDescricao] = useState<string>('Edição em lote');
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [selectedRangeDays, setSelectedRangeDays] = useState<DiaEscala[]>([]);
  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente | null>(null);
  const [modeloPendente, setModeloPendente] = useState<Modelo | null>(null);

  // Escala com os meses vizinhos: as regras da CLT (interjornada, DSR, semana) olham a virada do mês
  const escalaComVizinhos = useCallback((employeeId: string) => {
    const opcoes = employeeId === selectedScaleEmployee?.id
      ? { tipoEscala: planningScaleType, folgasDomingoNoMes: planningSundayOffs }
      : {};
    return [-1, 0, 1].flatMap((delta) => buildScaleForEmployee(employeeId, { ...opcoes, mes: mesVizinho(selectedScaleMonth, delta) }));
  }, [buildScaleForEmployee, planningScaleType, planningSundayOffs, selectedScaleEmployee?.id, selectedScaleMonth]);

  const escalaCalendario = useMemo(
    () => (selectedScaleEmployee ? escalaComVizinhos(selectedScaleEmployee.id) : []),
    [escalaComVizinhos, selectedScaleEmployee],
  );

  // Painel lateral: mesma escala com vizinhos que o calendário analisa (os dois dão o mesmo veredito)
  const colaboradoresDaLista = useMemo(
    () => (!selectedScaleEmployee || timelineEmployees.some((e) => e.id === selectedScaleEmployee.id)
      ? timelineEmployees
      : [selectedScaleEmployee, ...timelineEmployees]),
    [selectedScaleEmployee, timelineEmployees],
  );
  // shortcut: refaz 3 meses de escala de cada pessoa da lista a cada ajuste; memoizar por colaborador se a equipe passar de centenas
  const escalasDaLista = useMemo(
    () => new Map(colaboradoresDaLista.map((emp) => [emp.id, emp.id === selectedScaleEmployee?.id ? escalaCalendario : escalaComVizinhos(emp.id)])),
    [colaboradoresDaLista, escalaCalendario, escalaComVizinhos, selectedScaleEmployee?.id],
  );
  const propostosDoCalendario = useMemo(() => {
    const prefixo = `${selectedScaleEmployee?.id}:`;
    return new Set(suggestedPlanningKeys.filter((k) => k.startsWith(prefixo)).map((k) => k.slice(prefixo.length)));
  }, [selectedScaleEmployee?.id, suggestedPlanningKeys]);

  const popoverEmployeeId = selectedPlanningEmployeeId || selectedScaleEmployee?.id || null;
  const popoverEmployee = useMemo(
    () => (employees as Employee[]).find((e) => e.id === popoverEmployeeId) || null,
    [employees, popoverEmployeeId],
  );
  const escalaPopover = useMemo(() => {
    if (!isPopoverOpen || !popoverEmployeeId) return [];
    return popoverEmployeeId === selectedScaleEmployee?.id ? escalaCalendario : escalaComVizinhos(popoverEmployeeId);
  }, [escalaCalendario, escalaComVizinhos, isPopoverOpen, popoverEmployeeId, selectedScaleEmployee?.id]);

  const abrirDias = (employeeId: string, dias: DiaEscala[]) => {
    if (dias.length === 0) return;
    setSelectedPlanningEmployeeId(employeeId);
    setSelectedRangeDays(dias);
    setIsPopoverOpen(true);
  };

  const fecharDias = () => {
    setIsPopoverOpen(false);
    setSelectedPlanningEmployeeId(null);
    setSelectedRangeDays([]);
  };

  // Grava dia a dia; cada dia salvo já aparece na tela. Se um falhar, os anteriores ficam (o servidor já os tem),
  // os seguintes não são enviados e o modal continua aberto dizendo quantos foram salvos
  const salvarDias = async (alteracao: AlteracaoDias) => {
    const employeeId = popoverEmployeeId;
    if (!employeeId || !onSaveScaleOverride) throw new Error('Não é possível salvar a escala nesta tela.');
    const ajustes: ScaleOverridePayload[] = selectedRangeDays.map((dia) => {
      const tipo = alteracao.tipo ?? dia.tipo;
      return {
        colaboradorId: employeeId,
        data: dia.data,
        tipo,
        // Sem turno escolhido, o dia fica com o que tinha (inclusive "sem turno": a agenda aceita o horário da casa)
        turno: tipo === 'trabalho' ? alteracao.turno ?? turnoDoDia(dia) : undefined,
        // Sem mexer na observação, fica a nota já gravada (não o texto que o sistema gera, como "Feriado: ...")
        descricao: alteracao.descricao !== undefined ? alteracao.descricao || undefined : ajustesSalvos.get(`${employeeId}:${dia.data}`)?.descricao,
      };
    }).sort(trabalhoAntesDeFolga);

    // Mesma regra do servidor (6x1: uma folga por semana), conferida antes de gravar o primeiro dia
    // O contrato gravado, que é o que o servidor confere (não o tipo escolhido na tela e ainda não salvo)
    const tipoEscala = (employees as Employee[]).find((e) => e.id === employeeId)?.tipoEscala;
    const antes = escalaComVizinhos(employeeId);
    const porData = new Map(ajustes.map((a) => [a.data, a]));
    const excesso = folgaAcimaDoLimite(tipoEscala, antes, antes.map((dia) => aplicarAjusteEscala(dia, porData.get(dia.data))));
    if (excesso) throw new Error(mensagemFolgaAcimaDoLimite(tipoEscala!, excesso));

    let salvos = 0;
    for (const ajuste of ajustes) {
      try {
        if ((await onSaveScaleOverride(ajuste)) === false) throw new Error('O servidor não confirmou a gravação.');
      } catch (error) {
        const motivo = error instanceof Error ? error.message : 'Falha ao salvar.';
        throw new Error(ajustes.length > 1
          ? `Salvos ${salvos} de ${ajustes.length} dias. ${dataBR(ajuste.data)} não foi salvo: ${motivo}${salvos + 1 < ajustes.length ? ' Os dias seguintes não foram enviados.' : ''}`
          : motivo);
      }
      salvos += 1;
      const chave = `${employeeId}:${ajuste.data}`;
      setPlanningOverrides((prev) => ({ ...prev, [chave]: ajuste }));
      setSuggestedPlanningKeys((prev) => prev.filter((k) => k !== chave)); // gravado: deixa de ser proposta
    }
    setToastMessage(ajustes.length > 1 ? `Escala atualizada em ${ajustes.length} dias.` : 'Dia salvo.');
  };

  const escalaDe = (employeeId: string) =>
    employeeId === selectedScaleEmployee?.id ? selectedScaleCalendar.dias : buildScaleForEmployee(employeeId);
  const nomeDe = (employeeId: string) => (employees as Employee[]).find((e) => e.id === employeeId)?.name || 'colaborador';

  // Pede confirmação; dia ainda só na proposta não troca (a API gravaria um valor que ninguém confirmou)
  const pedirTroca = (troca: TrocaDias) => {
    if (troca.fromEmp === troca.toEmp && troca.fromDate === troca.toDate) return;
    if (troca.fromDate < todayStr || troca.toDate < todayStr) {
      setToastMessage('Dia que já passou não pode ser trocado.');
      return;
    }
    if ([`${troca.fromEmp}:${troca.fromDate}`, `${troca.toEmp}:${troca.toDate}`].some((k) => suggestedPlanningKeys.includes(k))) {
      setErrorMessage('Esse dia ainda é uma proposta não gravada. Confirme ou descarte a proposta antes de trocar.');
      return;
    }
    setAcaoPendente({ titulo: 'Trocar os dois dias?', descricao: descricaoTroca(troca), confirmLabel: 'Trocar', executar: () => trocarDias(troca) });
  };

  const ehProposta = (employeeId: string, data: string) => suggestedPlanningKeys.includes(`${employeeId}:${data}`);

  // Clique na Timeline em modo edição: alterna trabalho/folga, depois de confirmar
  const pedirAlternarDia = (employeeId: string, data: string, atual?: DiaEscala) => {
    if (data < todayStr) {
      setToastMessage('Esse dia já passou: a escala dele não pode ser alterada.');
      return;
    }
    const vira = atual?.tipo === 'trabalho' ? 'folga' : 'trabalho';
    setAcaoPendente({
      titulo: vira === 'folga' ? 'Marcar folga?' : 'Marcar dia de trabalho?',
      descricao: `${nomeDe(employeeId)}, ${dataBR(data)}: passa a ser ${vira}. A mudança é gravada na hora.`,
      confirmLabel: vira === 'folga' ? 'Marcar folga' : 'Marcar trabalho',
      executar: () => handleQuickToggleTimelineDay(employeeId, data, atual),
    });
  };

  const descricaoTroca = (t: TrocaDias) => (t.fromEmp === t.toEmp
    ? `${nomeDe(t.fromEmp)}: o dia ${dataBR(t.fromDate)} e o dia ${dataBR(t.toDate)} vão trocar de turno ou folga.`
    : `O dia ${dataBR(t.fromDate)} de ${nomeDe(t.fromEmp)} troca com o dia ${dataBR(t.toDate)} de ${nomeDe(t.toEmp)}.`)
    + ' A troca é gravada na hora.';

  // Troca dois dias (do mesmo colaborador ou de dois): aparece na hora e volta se o servidor recusar
  const trocarDias = ({ fromEmp, fromDate, toEmp, toDate }: TrocaDias) => {
    const fromDia = escalaDe(fromEmp).find((d) => d.data === fromDate);
    const toDia = escalaDe(toEmp).find((d) => d.data === toDate);
    if (!fromDia || !toDia) return;

    const fromKey = `${fromEmp}:${fromDate}`;
    const toKey = `${toEmp}:${toDate}`;
    const retrato = (dia: DiaEscala) => ({ tipo: dia.tipo, turno: dia.tipo === 'trabalho' ? turnoDoDia(dia) : undefined, descricao: dia.descricao });
    let prevFrom: ScaleOverridePayload | undefined;
    let prevTo: ScaleOverridePayload | undefined;

    setPlanningOverrides((prev) => {
      prevFrom = prev[fromKey];
      prevTo = prev[toKey];
      return {
        ...prev,
        [fromKey]: { colaboradorId: fromEmp, data: fromDate, ...retrato(toDia) },
        [toKey]: { colaboradorId: toEmp, data: toDate, ...retrato(fromDia) },
      };
    });

    const desfazer = () => setPlanningOverrides((prev) => {
      const next = { ...prev };
      if (prevFrom) next[fromKey] = prevFrom;
      else delete next[fromKey];
      if (prevTo) next[toKey] = prevTo;
      else delete next[toKey];
      return next;
    });

    void (async () => {
      try {
        const success = await onSwapScaleDays?.({
          from: { colaboradorId: fromEmp, data: fromDate, snapshot: retrato(fromDia) },
          to: { colaboradorId: toEmp, data: toDate, snapshot: retrato(toDia) },
        });
        if (success === false) {
          desfazer();
          setErrorMessage('Não foi possível sincronizar a troca de dias com o servidor.');
          return;
        }
        setToastMessage(`Troca gravada: ${dataBR(fromDate)} ↔ ${dataBR(toDate)}.`);
      } catch (error) {
        desfazer();
        setErrorMessage(error instanceof Error ? error.message : 'Falha na sincronização da troca de dias com o servidor.');
      }
    })();
  };

  // Alça de replicar da Timeline: copia um dia para os seguintes; pede confirmação e não mexe em dia passado
  const pedirReplicar = (empId: string, fromDay: number, toDay: number) => {
    const fromDate = `${selectedScaleMonth}-${String(fromDay).padStart(2, '0')}`;
    if (ehProposta(empId, fromDate)) {
      setErrorMessage('Esse dia ainda é uma proposta não gravada. Confirme ou descarte a proposta antes de replicá-lo.');
      return;
    }
    const start = Math.min(fromDay, toDay);
    const end = Math.max(fromDay, toDay);
    const targetDates = Array.from({ length: end - start + 1 }, (_, idx) => `${selectedScaleMonth}-${String(start + idx).padStart(2, '0')}`)
      .filter((date) => date !== fromDate && date >= todayStr);
    const sourceDia = buildScaleForEmployee(empId).find((d) => d.data === fromDate);
    if (!sourceDia || targetDates.length === 0) {
      setToastMessage('Não há dias futuros para replicar.');
      return;
    }
    const origem = { tipo: sourceDia.tipo, turno: sourceDia.tipo === 'trabalho' ? turnoDoDia(sourceDia) : undefined, descricao: sourceDia.descricao };
    setAcaoPendente({
      titulo: 'Replicar este dia?',
      descricao: `${nomeDe(empId)}: o dia ${dataBR(fromDate)} (${origem.tipo === 'trabalho' ? `trabalho${origem.turno ? ` ${origem.turno}` : ''}` : origem.tipo}) será copiado para ${targetDates.length} dia(s), de ${dataBR(targetDates[0])} a ${dataBR(targetDates[targetDates.length - 1])}, substituindo o que houver neles. A mudança é gravada na hora.`,
      confirmLabel: 'Replicar',
      executar: () => replicarDia(empId, fromDate, targetDates, origem),
    });
  };

  const replicarDia = (empId: string, fromDate: string, targetDates: string[], origem: Omit<ScaleOverridePayload, 'colaboradorId' | 'data'>) => {
    let prevSnapshot: Record<string, ScaleOverridePayload> = {};
    setPlanningOverrides((prev) => {
      prevSnapshot = prev;
      const next = { ...prev };
      targetDates.forEach((targetDate) => {
        next[`${empId}:${targetDate}`] = { colaboradorId: empId, data: targetDate, ...origem };
      });
      return next;
    });

    void (async () => {
      const revertReplication = () => {
        setPlanningOverrides((prev) => {
          const next = { ...prev };
          targetDates.forEach((targetDate) => {
            const key = `${empId}:${targetDate}`;
            if (prevSnapshot[key]) next[key] = prevSnapshot[key];
            else delete next[key];
          });
          return next;
        });
      };
      try {
        const success = await onReplicateScaleDays?.({ colaboradorId: empId, data: fromDate, targetDates, source: origem });
        if (success === false) {
          revertReplication();
          setErrorMessage('Não foi possível sincronizar a replicação da escala com o servidor.');
          return;
        }
        setToastMessage(`Replicação gravada em ${targetDates.length} dia(s).`);
      } catch (error) {
        revertReplication();
        setErrorMessage(error instanceof Error ? error.message : 'Falha na sincronização da replicação com o servidor.');
      }
    })();
  };

  const abrirModelo = (tipo: 'mesAnterior' | '12x36') => {
    if (!selectedScaleEmployee) return;
    const atual = selectedScaleCalendar.dias;
    const ajustes = (tipo === '12x36'
      ? preencher12x36(selectedScaleEmployee.id, atual)
      : repetirMesAnterior(
          selectedScaleEmployee.id,
          buildScaleForEmployee(selectedScaleEmployee.id, { tipoEscala: planningScaleType, folgasDomingoNoMes: planningSundayOffs, mes: mesVizinho(selectedScaleMonth, -1) }),
          atual,
          planningScaleType,
        )
    ).filter((ajuste) => ajuste.data >= todayStr); // dia passado a API recusa
    if (ajustes.length === 0) {
      setToastMessage(tipo === '12x36'
        ? `Nada a mudar: os próximos dias de ${selectedScaleEmployee.name} já seguem a 12x36.`
        : `Nada a mudar: o mês anterior de ${selectedScaleEmployee.name} não tem ajustes diferentes do ciclo.`);
      return;
    }
    setModeloPendente({
      titulo: tipo === '12x36' ? 'Preencher com plantões 12x36?' : 'Repetir o mês anterior?',
      aviso: tipo === '12x36' && (selectedScaleEmployee.tipoEscala || '6x1') !== '12x36'
        ? `O cadastro de ${selectedScaleEmployee.name} continua como ${selectedScaleEmployee.tipoEscala || '6x1'}: a CLT é conferida semana a semana e as semanas de 48h da 12x36 vão aparecer com alerta. Para o regime 12x36 de verdade (média semanal), mude o tipo de escala em "+ Nova Escala".`
        : undefined,
      descricao: `${ajustes.length} dia(s) de ${selectedScaleEmployee.name} em ${selectedScaleMonthLabel} vão mudar, inclusive ajustes feitos à mão nesses dias. Dias passados ficam como estão. Nada é gravado até você clicar em "Confirmar Escala".`,
      ajustes,
    });
  };

  const confirmarModelo = () => {
    if (!modeloPendente) return;
    proporAjustes(modeloPendente.ajustes);
    setToastMessage(`Proposta pronta em ${modeloPendente.ajustes.length} dia(s). Revise e clique em "Confirmar Escala" para gravar.`);
    setModeloPendente(null);
  };

  const handleApplyBatch = async () => {
    if (!batchTargetDate || batchSelectedIds.length === 0) return;
    if (!onSaveScaleOverride) return;
    setIsApplyingBatch(true);
    // Sem atualização otimista: antes a grade mostrava como salvo o que o servidor recusou. A grade recarrega
    // sozinha a cada gravação; quem falhou continua selecionado para tentar de novo
    const falhas: { id: string; motivo: string }[] = [];
    for (const empId of batchSelectedIds) {
      try {
        await onSaveScaleOverride({ colaboradorId: empId, data: batchTargetDate, tipo: batchShiftType, turno: batchShiftType === 'trabalho' ? batchShiftTurno : undefined, descricao: batchShiftDescricao });
      } catch (error) {
        falhas.push({ id: empId, motivo: error instanceof Error ? error.message : 'erro desconhecido' });
      }
    }
    setIsApplyingBatch(false);
    if (falhas.length === 0) {
      setToastMessage(`Lote aplicado para ${batchSelectedIds.length} colaboradores!`);
      setIsBatchEditOpen(false);
      setBatchSelectedIds([]);
      return;
    }
    setBatchSelectedIds(falhas.map((f) => f.id));
    setToastMessage(`Não foi salvo para ${falhas.length} de ${batchSelectedIds.length} colaboradores (${falhas[0].motivo}). Eles continuam selecionados.`);
  };

  // Uma função de fechar por modal (X, clique fora e Esc): não fecha durante o envio e pergunta se algo mudou.
  // "Cancelar" descarta de propósito, sem perguntar
  const geradorAlterado = useAlterado(isScaleGeneratorOpen, [scaleGeneratorEmployeeId, scaleGeneratorMonth, scaleGeneratorType, scaleGeneratorSundayOffs]);
  const fecharGerador = () => { if (!isSavingPlanning && confirmarSaida(geradorAlterado)) setIsScaleGeneratorOpen(false); };
  const loteAlterado = useAlterado(isBatchEditOpen, [batchSelectedIds, batchTargetDate, batchShiftType, batchShiftTurno, batchShiftDescricao]);
  const fecharLote = () => { if (!isApplyingBatch && confirmarSaida(loteAlterado)) setIsBatchEditOpen(false); };
  useModal(isScaleGeneratorOpen, fecharGerador);
  useModal(isBatchEditOpen, fecharLote);

  return (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative flex flex-col gap-6 items-start w-full">
          {/* Main Content Area - Calendário/Timeline Dominante */}
          <div className="flex-1 w-full min-w-0">
            <FolgasDoDia
              employees={props.activeNonAdminEmployees}
              scaleByEmployee={props.scaleByEmployee}
              mes={props.selectedScaleMonth}
              hoje={props.todayStr}
              onSwapScaleDays={onSwapScaleDays}
              setToastMessage={setToastMessage}
            />
            {/* Zonas de visualização e ações */}
            <div className={`bg-surface-container p-5 rounded-3xl border border-outline-variant/10 shadow-sm mb-6 transition-all ${isPlanningEditMode ? 'ring-1 ring-primary/45 border-primary/35' : ''}`}>
              {/* Linha 1: filtro, navegação temporal, modo de visualização */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-42.5">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Setor</label>
                    <select
                      value={filterRole}
                      onChange={(event) => setFilterRole(event.target.value)}
                      className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                    >
                      <option value="all">Todos</option>
                      {Array.from(
                        new Set<string>(
                          (employees as Employee[])
                            .map((employee) => employee.cargo || '')
                            .filter((cargo): cargo is string => Boolean(cargo))
                        )
                      ).map((cargo) => (
                        <option key={cargo} value={cargo}>{cargo}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeScaleMonthBy(-1)}
                    className="w-10 h-10 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center"
                    title="Mês anterior"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                  </button>

                  <button
                    type="button"
                    onClick={openPlanningMonthPicker}
                    className="px-4 h-10 rounded-xl border border-outline-variant/20 bg-surface-container-low text-sm font-bold uppercase tracking-[0.12em] text-on-surface hover:text-primary transition-colors"
                  >
                    {selectedScaleMonthLabel}
                  </button>

                  <button
                    type="button"
                    onClick={() => changeScaleMonthBy(1)}
                    className="w-10 h-10 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center"
                    title="Próximo mês"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>

                  <input
                    ref={planningMonthInputRef}
                    type="month"
                    value={selectedScaleMonth}
                    onChange={(event) => setSelectedScaleMonth(event.target.value)}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="absolute w-0 h-0 opacity-0 pointer-events-none"
                  />
                </div>

                <div className="flex items-center justify-start lg:justify-end gap-2">
                  <button
                    onClick={() => setPlanningViewMode('calendario')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                      planningViewMode === 'calendario'
                        ? 'bg-primary text-on-primary shadow-md'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-primary border border-outline-variant/20'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                    Calendário
                  </button>

                  <button
                    onClick={() => setPlanningViewMode('timeline')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                      planningViewMode === 'timeline'
                        ? 'bg-primary text-on-primary shadow-md'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-primary border border-outline-variant/20'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">view_timeline</span>
                    Timeline
                  </button>
                </div>
              </div>

              {/* Linha 2: busca e ações */}
              <div className="mt-4 pt-4 border-t border-outline-variant/10 flex flex-col lg:flex-row gap-3 lg:items-end lg:justify-between">
                <div className="w-full lg:max-w-md">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Buscar Funcionário</label>
                  <div className="relative">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant/70 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                    <input
                      type="text"
                      value={employeeSearchTerm}
                      onChange={(event) => setEmployeeSearchTerm(event.target.value)}
                      placeholder="Nome, cargo ou especialidade"
                      className="w-full h-11 pl-10 pr-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-start lg:justify-end gap-2">
                  <select
                    value={filterStatus}
                    onChange={(event) => setFilterStatus(event.target.value as 'all' | 'folgaHoje')}
                    className="h-11 min-w-42.5 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                    title="Filtrar status da equipe"
                  >
                    <option value="all">Status: Todos</option>
                    <option value="folgaHoje">Status: Folga hoje</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleTogglePlanningEditMode}
                    className={`h-11 px-5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                      isPlanningEditMode
                        ? 'bg-primary text-on-primary border-primary/40 shadow-md'
                        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:text-primary'
                    }`}
                  >
                    {isPlanningEditMode ? 'Concluir Edição' : 'Editar Grade'}
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenScaleGenerator}
                    className="h-11 px-5 bg-primary text-on-primary rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-primary-dim transition-all shadow-sm"
                  >
                    + Nova Escala
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsBatchEditOpen(true)}
                    className="h-11 px-5 rounded-xl border border-outline-variant/20 bg-surface-container text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:border-primary/40 hover:text-primary transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[16px]">checklist</span>
                    Edição em Lote
                  </button>

                  <button
                    type="button"
                    onClick={handleSuggestAutomaticScale}
                    className="h-11 px-5 rounded-xl bg-secondary-container/35 text-on-surface text-xs font-bold uppercase tracking-wider border border-outline-variant/20 hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    Sugerir Escala Automática
                  </button>

                  {/* Modelos rápidos para o colaborador aberto no calendário: viram proposta, gravada em "Confirmar Escala" */}
                  {planningViewMode === 'calendario' && selectedScaleEmployee && (
                    <>
                      <button
                        type="button"
                        onClick={() => abrirModelo('mesAnterior')}
                        className="h-11 px-4 rounded-xl bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border border-outline-variant/20 hover:border-primary/40 hover:text-primary transition-colors flex items-center gap-1.5"
                        title={`Repetir o mês anterior de ${selectedScaleEmployee.name}, seguindo o ciclo da escala`}
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        Repetir Mês Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => abrirModelo('12x36')}
                        className="h-11 px-4 rounded-xl bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider border border-outline-variant/20 hover:border-primary/40 hover:text-primary transition-colors flex items-center gap-1.5"
                        title={`Preencher o mês de ${selectedScaleEmployee.name} com plantões 12x36`}
                      >
                        <span className="material-symbols-outlined text-[16px]">repeat</span>
                        Padrão 12x36
                      </button>
                    </>
                  )}

                  {suggestedPlanningKeys.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleConfirmSuggestedScale}
                        disabled={isSavingPlanning}
                        className="h-11 px-5 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-wider hover:bg-primary-dim disabled:opacity-60 transition-colors"
                      >
                        {isSavingPlanning ? 'Confirmando...' : `Confirmar Escala (${suggestedPlanningKeys.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={handleDiscardSuggestedScale}
                        disabled={isSavingPlanning}
                        className="h-11 px-4 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:text-error disabled:opacity-60 transition-colors"
                      >
                        Descartar Proposta
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowTopAlerts((prev) => !prev)}
                    className="hidden lg:flex items-center gap-2 h-11 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all bg-surface-container-low text-on-surface-variant hover:text-primary border border-outline-variant/20"
                  >
                    <span className="material-symbols-outlined text-[16px]">{showTopAlerts ? 'notifications_off' : 'notifications'}</span>
                    {showTopAlerts ? 'Ocultar Alertas' : 'Mostrar Alertas'}
                  </button>
                </div>
              </div>

              {/* Linha 3: filtros avançados combináveis */}
              <div className="mt-4 pt-4 border-t border-outline-variant/10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Recorte</label>
                  <select
                    value={planningDateScope}
                    onChange={(event) => setPlanningDateScope(event.target.value as 'mensal' | 'semanal')}
                    className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                  >
                    <option value="mensal">Mensal</option>
                    <option value="semanal">Semanal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Semana</label>
                  <select
                    value={planningWeekIndex}
                    onChange={(event) => setPlanningWeekIndex(Number(event.target.value) || 1)}
                    disabled={planningDateScope !== 'semanal'}
                    className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface disabled:opacity-60"
                  >
                    {planningWeekOptions.map((week: number) => (
                      <option key={week} value={week}>Semana {week}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Colaborador</label>
                  <select
                    value={planningEmployeeFilter}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPlanningEmployeeFilter(value);
                      if (value !== 'all') setSelectedScaleEmployeeId(value);
                    }}
                    className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                  >
                    <option value="all">Todos</option>
                    {(employees as Employee[])
                      .filter((employee) => isTeamMember(employee))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Turno</label>
                  <select
                    value={planningShiftFilter}
                    onChange={(event) => setPlanningShiftFilter(event.target.value as 'all' | 'manha' | 'tarde' | 'noite' | 'comercial' | 'folga')}
                    className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                  >
                    <option value="all">Todos</option>
                    <option value="manha">Manhã</option>
                    <option value="tarde">Tarde</option>
                    <option value="noite">Noite</option>
                    <option value="comercial">Comercial</option>
                    <option value="folga">Folga/FDS</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Carga Semanal</label>
                  <select
                    value={planningWorkloadFilter}
                    onChange={(event) => setPlanningWorkloadFilter(event.target.value as 'all' | 'ate36' | '37a44' | '45plus')}
                    className="w-full h-11 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                  >
                    <option value="all">Todas</option>
                    <option value="ate36">Até 36h</option>
                    <option value="37a44">37h a 44h</option>
                    <option value="45plus">45h ou mais</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPlanningDateScope('mensal');
                      setPlanningWeekIndex(1);
                      setPlanningEmployeeFilter('all');
                      setPlanningShiftFilter('all');
                      setPlanningWorkloadFilter('all');
                    }}
                    className="w-full h-11 px-4 rounded-xl border border-outline-variant/20 bg-surface-container-low text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
                  >
                    Limpar Filtros
                  </button>
                </div>
              </div>
            </div>

            {showTopAlerts && (
              <>
                <div className="xl:hidden mb-4 space-y-2">
                  {visibleCltToastAlerts.slice(0, 1).map((alerta) => (
                    <div key={`mobile-alert-${alerta.id}`} className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2">
                      <p className="text-[11px] font-bold text-amber-500">Alerta CLT: {alerta.nome}</p>
                      <p className="text-[11px] text-on-surface-variant line-clamp-1 mt-1">{alerta.resumo[0] || 'Inconformidade detectada'}</p>
                    </div>
                  ))}

                  {pendingTurnoSwapRequests.slice(0, 1).map((request) => (
                    <div key={`mobile-swap-${request.id}`} className="rounded-xl border border-secondary/30 bg-secondary-container/20 px-3 py-2">
                      <p className="text-[11px] font-bold text-on-surface">Solicitação: {request.colaboradorNome || request.colaboradorId}</p>
                      <p className="text-[11px] text-on-surface-variant line-clamp-1 mt-1">{request.dataOriginal} → {request.dataSolicitada}</p>
                    </div>
                  ))}
                </div>

                <div className="hidden xl:block pointer-events-none fixed top-28 right-6 z-30 w-80 space-y-2">
                  {visibleCltToastAlerts.slice(0, 3).map((alerta) => (
                    <motion.div
                      key={`toast-alert-${alerta.id}`}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="pointer-events-auto rounded-xl border border-amber-400/35 bg-amber-500/10 backdrop-blur-sm p-3 shadow-lg"
                    >
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-amber-500 text-[18px]">warning</span>
                        <p className="text-xs font-bold text-amber-500">Alerta CLT • {alerta.nome}</p>
                        <button
                          type="button"
                          onClick={() => setDismissedCltAlertIds((prev) => ({ ...prev, [alerta.id]: true }))}
                          className="ml-auto w-6 h-6 rounded-md border border-amber-400/40 text-amber-500/80 hover:text-amber-500 hover:bg-amber-500/10"
                          title="Dispensar alerta"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-2">{alerta.resumo[0] || 'Inconformidade detectada'}</p>
                    </motion.div>
                  ))}

                  {pendingTurnoSwapRequests.length > 0 && (
                    <div className="pointer-events-auto max-h-[44vh] overflow-y-auto space-y-2 pr-1">
                      {pendingTurnoSwapRequests.map((request) => (
                        <motion.div
                          key={`toast-swap-${request.id}`}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="rounded-xl border border-secondary/30 bg-surface-container-high/95 backdrop-blur-sm p-3 shadow-lg"
                        >
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-secondary text-[18px]">swap_horiz</span>
                            <p className="text-xs font-bold text-on-surface">Troca • {request.colaboradorNome || request.colaboradorId}</p>
                          </div>
                          <p className="text-[11px] text-on-surface-variant mt-2 line-clamp-1">{request.dataOriginal} → {request.dataSolicitada}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={updatingSwapId === request.id}
                              onClick={() => handleUpdateSwapStatus(request.id, 'aprovada')}
                              className="flex-1 h-7 rounded-lg bg-primary text-on-primary text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              disabled={updatingSwapId === request.id}
                              onClick={() => handleUpdateSwapStatus(request.id, 'rejeitada')}
                              className="flex-1 h-7 rounded-lg bg-error/20 text-error text-[11px] font-bold uppercase tracking-wider disabled:opacity-50"
                            >
                              Rejeitar
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Calendário ou Timeline */}
            {selectedScaleEmployee ? (
              <>
                {planningViewMode === 'calendario' && (
                  <div className="flex flex-col xl:flex-row gap-6 items-start">
                    <PlanningEmployeeSidebar
                      employees={colaboradoresDaLista}
                      selectedEmployeeId={selectedScaleEmployee.id}
                      onSelectEmployee={(employeeId) => {
                        setSelectedScaleEmployeeId(employeeId);
                        if (planningEmployeeFilter !== 'all') {
                          setPlanningEmployeeFilter(employeeId);
                        }
                      }}
                      escalas={escalasDaLista}
                      prefixoMes={`${selectedScaleMonth}-`}
                    />

                    <div className="flex-1 w-full min-w-0">
                      <CalendarioEscala
                        key={selectedScaleEmployee.id} // trocar de pessoa zera dia escolhido e seleção
                        propostos={propostosDoCalendario}
                        escalas={escalaCalendario}
                        year={selectedScaleCalendar.year}
                        month={selectedScaleCalendar.month}
                        hoje={todayStr}
                        dayRange={planningVisibleDayRange}
                        tipoEscala={planningScaleType}
                        cargaHorariaSemanal={selectedScaleEmployee.cargaHorariaSemanal ?? 44}
                        colaboradorNome={selectedScaleEmployee.name}
                        colaboradorCargo={selectedScaleEmployee.cargo || selectedScaleEmployee.specialty}
                        modo={isPlanningEditMode ? 'trocar' : 'editar'}
                        onDayClick={(dia) => abrirDias(selectedScaleEmployee.id, [dia])}
                        onRangeSelect={(dias) => abrirDias(selectedScaleEmployee.id, dias)}
                        onDayDrop={(from, to) => pedirTroca({
                          fromEmp: selectedScaleEmployee.id,
                          fromDate: `${selectedScaleMonth}-${String(from).padStart(2, '0')}`,
                          toEmp: selectedScaleEmployee.id,
                          toDate: `${selectedScaleMonth}-${String(to).padStart(2, '0')}`,
                        })}
                      />
                    </div>
                  </div>
                )}

                {planningViewMode === 'timeline' && (
                  <TimelineGantt
                    employees={timelineEmployees}
                    appointments={appointments}
                    month={selectedScaleMonth}
                    dayRange={planningVisibleDayRange}
                    hideMonthBadge
                    isEditable={isPlanningEditMode}
                    suggestedKeys={suggestedPlanningKeys}
                    overrides={planningOverridesList.filter((override) => override.data.startsWith(`${selectedScaleMonth}-`))}
                    onQuickToggleDay={pedirAlternarDia}
                    onQuickSetDay={handleQuickSetTimelineDay}
                    onClick={(empleoyeeId, day) => {
                      const escala = buildScaleForEmployee(empleoyeeId);
                      const selectedDay = escala.find((d) => d.data === day);
                      if (!selectedDay) return;
                      if (selectedDay.data < todayStr) {
                        setToastMessage('Esse dia já passou: a escala dele não pode ser alterada.');
                        return;
                      }
                      setSelectedScaleEmployeeId(empleoyeeId);
                      abrirDias(empleoyeeId, [selectedDay]);
                    }}
                    onShiftDrop={(fromEmp, fromDay, toEmp, toDay) => pedirTroca({ fromEmp, fromDate: fromDay, toEmp, toDate: toDay })}
                    onReplicate={(empId, fromDay, toDay) => pedirReplicar(empId, fromDay, toDay)}
                    minStaffRequired={Math.max(1, planningCoverageTarget)}
                  />
                )}
              </>
            ) : (
              <div className="bg-surface-container-lowest p-12 rounded-3xl border border-outline-variant/10 shadow-sm text-center">
                <p className="text-on-surface-variant text-sm">
                  <span className="material-symbols-outlined text-4xl mb-2 block opacity-50">info</span>
                  Nenhum colaborador disponível para visualizar escala.
                </p>
              </div>
            )}
          </div>

          {/* Edição de um dia ou de vários (seleção no calendário); a chave recria o estado a cada abertura */}
          {isPopoverOpen && popoverEmployeeId && selectedRangeDays.length > 0 && (
            <PlanningDayPopover
              key={`${popoverEmployeeId}:${selectedRangeDays.map((d) => d.data).join(',')}`}
              dias={selectedRangeDays}
              colaborador={popoverEmployee}
              escalaContexto={escalaPopover}
              notaSalva={ajustesSalvos.get(`${popoverEmployeeId}:${selectedRangeDays[0].data}`)?.descricao}
              scaleByEmployee={props.scaleByEmployee}
              onClose={fecharDias}
              onSave={salvarDias}
            />
          )}

          <ConfirmDialog
            open={acaoPendente !== null}
            tone="primary"
            icon="edit_calendar"
            title={acaoPendente?.titulo || ''}
            description={acaoPendente?.descricao}
            confirmLabel={acaoPendente?.confirmLabel}
            onConfirm={() => { acaoPendente?.executar(); setAcaoPendente(null); }}
            onClose={() => setAcaoPendente(null)}
          />

          <ConfirmDialog
            open={modeloPendente !== null}
            tone="primary"
            icon="edit_calendar"
            title={modeloPendente?.titulo || ''}
            description={modeloPendente?.descricao}
            confirmLabel="Montar proposta"
            onConfirm={confirmarModelo}
            onClose={() => setModeloPendente(null)}
          >
            {modeloPendente?.aviso && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{modeloPendente.aviso}</p>
            )}
          </ConfirmDialog>

          {isScaleGeneratorOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
                onClick={fecharGerador}
                aria-label="Fechar modal"
              />

              <div role="dialog" aria-modal="true" aria-label="Gerar escala" className="relative w-full max-w-2xl rounded-3xl border border-outline-variant/20 bg-surface-container shadow-2xl p-6">
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-xl font-headline text-on-surface">Gerar Nova Escala</h3>
                    <p className="text-sm text-on-surface-variant mt-1">Defina colaborador, mês e jornada para atualizar a grade.</p>
                  </div>
                  <button
                    type="button"
                    onClick={fecharGerador}
                    aria-label="Fechar"
                    className="w-9 h-9 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center"
                    title="Fechar"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Colaborador</label>
                      <input
                        type="text"
                        value={scaleGeneratorSearch}
                        onChange={(event) => setScaleGeneratorSearch(event.target.value)}
                        placeholder="Buscar colaborador"
                        className="w-full h-10 mb-2 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      />
                      <select
                        value={scaleGeneratorEmployeeId}
                        onChange={(event) => setScaleGeneratorEmployeeId(event.target.value)}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      >
                        {filteredScaleGeneratorEmployees.length === 0 && (
                          <option value="">Nenhum colaborador encontrado</option>
                        )}
                        {filteredScaleGeneratorEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>{employee.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Mês</label>
                      <input
                        type="month"
                        value={scaleGeneratorMonth}
                        onChange={(event) => setScaleGeneratorMonth(event.target.value)}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Tipo de Escala</label>
                      <select
                        value={scaleGeneratorType || '6x1'}
                        onChange={(event) => setScaleGeneratorType(event.target.value as Employee['tipoEscala'])}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      >
                        <option value="6x1">6x1 (6 dias trabalho, 1 folga)</option>
                        <option value="5x1">5x1 (5 dias trabalho, 1 folga)</option>
                        <option value="5x2">5x2 (5 dias trabalho, 2 folgas)</option>
                        <option value="12x36">12x36 (12h trabalho, 36h folga)</option>
                        <option value="rotativo">Rotativo</option>
                        {/* Sem "Personalizado": a API só aceita 6x1, 5x2, 5x1, 12x36 e rotativo (recusava com 400) */}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Folgas no Domingo</label>
                      <div className="h-11 rounded-xl bg-surface-container-low border border-outline-variant/20 px-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setScaleGeneratorSundayOffs((current) => Math.max(0, current - 1))}
                          className="w-8 h-8 rounded-lg border border-outline-variant/20 text-on-surface-variant hover:text-primary"
                        >
                          -
                        </button>
                        <span className="text-sm font-bold text-on-surface tabular-nums">{scaleGeneratorSundayOffs}</span>
                        <button
                          type="button"
                          onClick={() => setScaleGeneratorSundayOffs((current) => Math.min(5, current + 1))}
                          className="w-8 h-8 rounded-lg border border-outline-variant/20 text-on-surface-variant hover:text-primary"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Meta de Cobertura</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={scaleGeneratorCoverageTarget}
                        onChange={(event) => setScaleGeneratorCoverageTarget(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                        placeholder="Mínimo ativo por dia"
                      />
                      <p className="mt-1 text-[11px] text-on-surface-variant">Mínimo de colaboradores ativos por dia.</p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Regra de Domingos</label>
                      <select
                        value={scaleGeneratorSundayFrequency}
                        onChange={(event) => setScaleGeneratorSundayFrequency(event.target.value as '1x1' | '2x1')}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      >
                        <option value="1x1">1 domingo de folga a cada 1 trabalhado (1x1)</option>
                        <option value="2x1">1 domingo de folga a cada 2 trabalhados (2x1)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-outline-variant/10 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setIsScaleGeneratorOpen(false)}
                    disabled={isSavingPlanning}
                    className="h-11 px-5 rounded-xl border border-outline-variant/20 text-sm font-semibold text-on-surface-variant hover:text-on-surface"
                  >
                    Cancelar
                  </button>

                  <button
                    type="button"
                    onClick={handleGenerateScale}
                    disabled={!scaleGeneratorEmployeeId || isSavingPlanning}
                    className="h-11 px-6 rounded-xl bg-primary text-on-primary text-sm font-bold uppercase tracking-wider hover:bg-primary-dim disabled:opacity-60"
                  >
                    {isSavingPlanning ? 'Gerando...' : 'Gerar Escala'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isBatchEditOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
                onClick={fecharLote}
                aria-label="Fechar modal"
              />

              <div role="dialog" aria-modal="true" aria-label="Edição em Lote" className="relative w-full max-w-md rounded-3xl border border-outline-variant/20 bg-surface-container shadow-2xl p-6 flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-headline text-on-surface">Edição em Lote</h2>
                  <button type="button" onClick={fecharLote} disabled={isApplyingBatch} aria-label="Fechar" className="p-2 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-colors disabled:opacity-40">
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>

                <div className="mb-4">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Data Alvo</label>
                  <input type="date" value={batchTargetDate} onChange={e => setBatchTargetDate(e.target.value)} className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary" />
                </div>

                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant">Colaboradores ({batchSelectedIds.length})</label>
                  <button onClick={() => setBatchSelectedIds(batchSelectedIds.length === timelineEmployees.length ? [] : timelineEmployees.map((e) => e.id))} className="text-[11px] font-bold uppercase tracking-wider text-primary hover:text-primary-dim transition-colors">
                    {batchSelectedIds.length === timelineEmployees.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto mb-4 border border-outline-variant/20 bg-surface-container-low rounded-xl p-2 custom-scrollbar">
                   {timelineEmployees.map((emp) => (
                     <label key={emp.id} className="flex items-center gap-3 p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors">
                       <input type="checkbox" checked={batchSelectedIds.includes(emp.id)} onChange={() => {
                         setBatchSelectedIds(prev => prev.includes(emp.id) ? prev.filter(id => id !== emp.id) : [...prev, emp.id]);
                       }} className="w-4 h-4 rounded border-outline-variant/30 text-primary focus:ring-primary bg-surface-container-lowest" />
                       <span className="text-sm font-medium text-on-surface">{emp.name}</span>
                     </label>
                   ))}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Ação</label>
                    <select value={batchShiftType} onChange={e => setBatchShiftType(e.target.value as typeof batchShiftType)} className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer">
                      <option value="trabalho">Trabalho</option>
                      <option value="folga">Folga</option>
                      <option value="fds">FDS</option>
                    </select>
                  </div>
                  {batchShiftType === 'trabalho' && (
                    <div>
                      <label htmlFor="lote-turno" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Turno</label>
                      <TurnoSelect id="lote-turno" value={batchShiftTurno} onChange={setBatchShiftTurno} className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer" />
                    </div>
                  )}
                </div>

                <div className="mb-6">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Motivo/Descrição</label>
                  <input type="text" value={batchShiftDescricao} onChange={e => setBatchShiftDescricao(e.target.value)} className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Ex: Ajuste coletivo, Feriado..." />
                </div>

                <button
                  onClick={handleApplyBatch}
                  disabled={batchSelectedIds.length === 0 || !batchTargetDate || isApplyingBatch}
                  className="w-full h-11 bg-primary text-on-primary rounded-xl font-bold uppercase tracking-wider hover:bg-primary-dim transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-sm"
                >
                  {isApplyingBatch ? 'Aplicando Lote...' : 'Aplicar em Lote'}
                </button>
              </div>
            </div>
          )}
        </motion.div>

  );
}
