import { formatarDataBR } from '@shared/datasBR';
import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Employee, TurnoSwapRequest } from '../../../types';
import { useTurnos, type ScaleOverridePayload } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { aplicarAjusteEscala, type DiaEscala } from '../../../utils/escalaCalculator';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { CalendarioEscala } from './CalendarioEscala';
import { PlanningDayPopover, type AlteracaoDias } from './PlanningDayPopover';
import { analisarMes, retratoDoDia, trabalhoAntesDeFolga, turnoDoDia, visualDoDia } from '../utils/turnos';

import { folgaAcimaDoLimite, mensagemFolgaAcimaDoLimite } from '@shared/escala';
import { preencher12x36, repetirMesAnterior } from '../utils/modelosEscala';
import { PlanningEmployeeSidebar } from './PlanningEmployeeSidebar';
import { TimelineGantt } from './TimelineGantt';
import { FolgasDoDia } from './FolgasDoDia';
import { TurnoSelect } from './TurnoSelect';
import { confirmarSaida, useAlterado, useModal } from '../../../hooks/useModal';
import type { usePlanejamentoEscala } from '../hooks/usePlanejamentoEscala';
import type { SupervisorViewProps } from '../../../components/SupervisorView';

type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type AlertaClt = { id: string; nome: string; conforme: boolean; resumo: string[] };
type TrocaDias = { fromEmp: string; fromDate: string; toEmp: string; toDate: string };
// Ação da grade que grava na hora: só roda depois do "sim" no ConfirmDialog
type AcaoPendente = {
  titulo: string;
  descricao: string;
  confirmLabel: string;
  executar: () => void;
  icone?: string;
  perigo?: boolean; // muda vários dias de uma vez: o foco começa em "Cancelar"
};
type Modelo = { titulo: string; descricao: string; aviso?: string; ajustes: ScaleOverridePayload[] };

const mesVizinho = (mes: string, delta: number) => {
  const [ano, m] = mes.split('-').map(Number);
  const data = new Date(ano, m - 1 + delta, 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
};
const MENSAGEM_PROPOSTA = 'Esse dia ainda é uma proposta não gravada. Confirme ou descarte a proposta antes de alterá-lo.';

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
    suggestedPlanningKeys,
    handleConfirmSuggestedScale,
    handleDiscardSuggestedScale,
    proporAjustes,
    aplicarComReversao,
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
    scaleGeneratorTurno,
    setScaleGeneratorTurno,
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

  // Estados da Edição em Lote (Bulk Edit), menus compactos e Drag-to-Select no Calendário
  const [isBatchEditOpen, setIsBatchEditOpen] = useState(false);
  const [filtrosAberto, setFiltrosAberto] = useState(false);
  const [acoesAberto, setAcoesAberto] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchTargetDate, setBatchTargetDate] = useState<string>('');
  const [batchShiftType, setBatchShiftType] = useState<'trabalho' | 'folga' | 'fds'>('trabalho');
  const [batchShiftTurno, setBatchShiftTurno] = useState<string>('08:00-18:00');
  const [batchShiftDescricao, setBatchShiftDescricao] = useState<string>('Edição em lote');
  const [isApplyingBatch, setIsApplyingBatch] = useState(false);
  const [selectedRangeDays, setSelectedRangeDays] = useState<DiaEscala[]>([]);
  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente | null>(null);
  const [modeloPendente, setModeloPendente] = useState<Modelo | null>(null);
  const filtrosAtivosCount = (filterStatus !== 'all' ? 1 : 0) + (planningShiftFilter !== 'all' ? 1 : 0) + (planningWorkloadFilter !== 'all' ? 1 : 0);

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
          ? `Salvos ${salvos} de ${ajustes.length} dias. ${formatarDataBR(ajuste.data)} não foi salvo: ${motivo}${salvos + 1 < ajustes.length ? ' Os dias seguintes não foram enviados.' : ''}`
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

  // Uma regra (e uma frase) para tudo que grava na hora: dia passado a API recusa; dia que ainda é proposta gravaria um
  // valor que ninguém confirmou. Devolve true quando pode seguir
  const podeAlterarNaHora = (dias: Array<{ employeeId: string; data: string }>) => {
    if (dias.some((d) => d.data < todayStr)) {
      setToastMessage('Dia que já passou não pode ser alterado.');
      return false;
    }
    if (dias.some((d) => suggestedPlanningKeys.includes(`${d.employeeId}:${d.data}`))) {
      setErrorMessage(MENSAGEM_PROPOSTA);
      return false;
    }
    return true;
  };

  // Retrato do dia para gravar: turno legível e a observação gravada (não o texto que o sistema gera, como "Feriado: ...")
  const retrato = (employeeId: string, dia: DiaEscala) => retratoDoDia(employeeId, dia, ajustesSalvos);

  const pedirTroca = (troca: TrocaDias) => {
    if (troca.fromEmp === troca.toEmp && troca.fromDate === troca.toDate) return;
    if (!podeAlterarNaHora([{ employeeId: troca.fromEmp, data: troca.fromDate }, { employeeId: troca.toEmp, data: troca.toDate }])) return;
    // Os dois dias são lidos agora, quando o diálogo descreve a troca, e não quando a pessoa confirma
    const fromDia = escalaDe(troca.fromEmp).find((d) => d.data === troca.fromDate);
    const toDia = escalaDe(troca.toEmp).find((d) => d.data === troca.toDate);
    if (!fromDia || !toDia) return;
    const deOrigem = retrato(troca.fromEmp, fromDia);
    const deDestino = retrato(troca.toEmp, toDia);
    setAcaoPendente({
      titulo: 'Trocar os dois dias?',
      descricao: descricaoTroca(troca),
      confirmLabel: 'Trocar',
      icone: 'swap_horiz',
      executar: () => trocarDias(troca, deOrigem, deDestino),
    });
  };

  // Clique na Timeline em modo edição: alterna trabalho/folga, depois de confirmar
  const pedirAlternarDia = (employeeId: string, data: string, atual?: DiaEscala) => {
    if (!podeAlterarNaHora([{ employeeId, data }])) return;
    const vira = atual?.tipo === 'trabalho' ? 'folga' : 'trabalho';
    setAcaoPendente({
      titulo: vira === 'folga' ? 'Marcar folga?' : 'Marcar dia de trabalho?',
      descricao: `${nomeDe(employeeId)}, ${formatarDataBR(data)}: passa a ser ${vira}. A mudança é gravada na hora.`,
      confirmLabel: vira === 'folga' ? 'Marcar folga' : 'Marcar trabalho',
      executar: () => handleQuickToggleTimelineDay(employeeId, data, atual),
    });
  };

  // Menu rápido da Timeline (turno padrão ou folga): mesma regra e mesma confirmação do clique
  const pedirDefinirDia = (employeeId: string, data: string, tipo: DiaEscala['tipo'], turno?: string) => {
    if (!podeAlterarNaHora([{ employeeId, data }])) return;
    const comoFica = tipo === 'trabalho' ? `trabalho${turno ? `, ${turno.replace('-', ' às ')}` : ''}` : 'folga';
    setAcaoPendente({
      titulo: tipo === 'trabalho' ? 'Definir o turno do dia?' : 'Marcar folga?',
      descricao: `${nomeDe(employeeId)}, ${formatarDataBR(data)}: passa a ser ${comoFica}. A mudança é gravada na hora.`,
      confirmLabel: tipo === 'trabalho' ? 'Definir turno' : 'Marcar folga',
      executar: () => handleQuickSetTimelineDay(employeeId, data, tipo, turno),
    });
  };

  const descricaoTroca = (t: TrocaDias) => (t.fromEmp === t.toEmp
    ? `${nomeDe(t.fromEmp)}: o dia ${formatarDataBR(t.fromDate)} e o dia ${formatarDataBR(t.toDate)} vão trocar de turno ou folga.`
    : `O dia ${formatarDataBR(t.fromDate)} de ${nomeDe(t.fromEmp)} troca com o dia ${formatarDataBR(t.toDate)} de ${nomeDe(t.toEmp)}.`)
    + ' A troca é gravada na hora.';

  // Troca dois dias (do mesmo colaborador ou de dois): aparece na hora e volta se o servidor recusar
  type Retrato = ReturnType<typeof retrato>;
  const trocarDias = ({ fromEmp, fromDate, toEmp, toDate }: TrocaDias, deOrigem: Retrato, deDestino: Retrato) => {
    aplicarComReversao(
      [{ colaboradorId: fromEmp, data: fromDate, ...deDestino }, { colaboradorId: toEmp, data: toDate, ...deOrigem }],
      () => onSwapScaleDays?.({
        from: { colaboradorId: fromEmp, data: fromDate, snapshot: deOrigem },
        to: { colaboradorId: toEmp, data: toDate, snapshot: deDestino },
      }),
      { sucesso: `Troca gravada: ${formatarDataBR(fromDate)} ↔ ${formatarDataBR(toDate)}.`, falha: 'Não foi possível gravar a troca de dias.' },
    );
  };

  // Alça de replicar da Timeline: copia um dia para os seguintes; pede confirmação e não mexe em dia passado
  const pedirReplicar = (empId: string, fromDay: number, toDay: number) => {
    const fromDate = `${selectedScaleMonth}-${String(fromDay).padStart(2, '0')}`;
    const start = Math.min(fromDay, toDay);
    const end = Math.max(fromDay, toDay);
    const noIntervalo = Array.from({ length: end - start + 1 }, (_, idx) => `${selectedScaleMonth}-${String(start + idx).padStart(2, '0')}`)
      .filter((date) => date !== fromDate);
    const targetDates = noIntervalo.filter((date) => date >= todayStr);
    // Origem e destinos não podem ser proposta pendente; a origem pode ser dia passado (só é copiada)
    if ([fromDate, ...targetDates].some((data) => suggestedPlanningKeys.includes(`${empId}:${data}`))) {
      setErrorMessage(MENSAGEM_PROPOSTA);
      return;
    }
    const sourceDia = buildScaleForEmployee(empId).find((d) => d.data === fromDate);
    if (!sourceDia || targetDates.length === 0) {
      setToastMessage('Não há dias futuros para replicar.');
      return;
    }
    const origem = retrato(empId, sourceDia);
    const comoFica = origem.tipo === 'trabalho'
      ? `trabalho${origem.turno ? `, ${origem.turno.replace('-', ' às ')}` : ', sem turno definido'}`
      : visualDoDia(sourceDia).rotulo.toLowerCase();
    const passados = noIntervalo.length - targetDates.length;
    setAcaoPendente({
      titulo: 'Replicar este dia?',
      descricao: `${nomeDe(empId)}: o dia ${formatarDataBR(fromDate)} (${comoFica}) será copiado para ${targetDates.length} dia(s), de ${formatarDataBR(targetDates[0])} a ${formatarDataBR(targetDates[targetDates.length - 1])}, substituindo o que houver neles.${passados > 0 ? ` ${passados} dia(s) que já passaram ficam como estão.` : ''} A mudança é gravada na hora.`,
      confirmLabel: 'Replicar',
      icone: 'content_copy',
      perigo: true,
      executar: () => replicarDia(empId, fromDate, targetDates, origem),
    });
  };

  const replicarDia = (empId: string, fromDate: string, targetDates: string[], origem: Retrato) => {
    aplicarComReversao(
      targetDates.map((data) => ({ colaboradorId: empId, data, ...origem })),
      () => onReplicateScaleDays?.({ colaboradorId: empId, data: fromDate, targetDates, source: origem }),
      { sucesso: `Replicação gravada em ${targetDates.length} dia(s).`, falha: 'Não foi possível gravar a replicação.' },
    );
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
    // Avisa só o que a proposta de fato viola, pela mesma análise do calendário (com o tipo de escala do cadastro)
    const porData = new Map(ajustes.map((ajuste) => [ajuste.data, ajuste]));
    const analise = analisarMes(
      escalaCalendario.map((dia) => aplicarAjusteEscala(dia, porData.get(dia.data))),
      `${selectedScaleMonth}-`,
      planningScaleType,
    );
    setModeloPendente({
      titulo: tipo === '12x36' ? 'Preencher com plantões 12x36?' : 'Repetir o mês anterior?',
      aviso: analise.conforme
        ? undefined
        : `Com esta proposta, a escala de ${selectedScaleEmployee.name} fica com alerta da CLT: ${analise.alertas.join(' ')}${
          tipo === '12x36' && planningScaleType !== '12x36' ? ' O cadastro não é 12x36: a carga é conferida semana a semana, não pela média. Para mudar o regime, use "+ Nova Escala".' : ''}`,
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
  const geradorAlterado = useAlterado(isScaleGeneratorOpen, [scaleGeneratorEmployeeId, scaleGeneratorMonth, scaleGeneratorType, scaleGeneratorSundayOffs, scaleGeneratorTurno]);
  const { token } = useAuth();
  const { data: turnosCadastrados = [] } = useTurnos(token);
  const colaboradorDoGerador = filteredScaleGeneratorEmployees.find((e) => e.id === scaleGeneratorEmployeeId)
    ?? props.activeNonAdminEmployees.find((e) => e.id === scaleGeneratorEmployeeId);
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
            {/* Barra principal enxuta: Mês, Busca, Setor, Calendário/Timeline, Filtros, Ações e + Nova Escala */}
            <div className="bg-surface-container p-4 sm:p-5 rounded-3xl border border-outline-variant/10 shadow-sm mb-6 space-y-4">
              {/* Linha 1: Setor, Mês e alternância Calendário / Timeline */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => changeScaleMonthBy(-1)}
                    className="w-10 h-10 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center"
                    title="Mês anterior"
                    aria-label="Mês anterior"
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
                    aria-label="Próximo mês"
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

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-xl bg-surface-container-low p-1 border border-outline-variant/20" role="group" aria-label="Visualização da escala">
                    <button
                      type="button"
                      onClick={() => setPlanningViewMode('calendario')}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        planningViewMode === 'calendario'
                          ? 'bg-primary text-on-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                      Calendário
                    </button>

                    <button
                      type="button"
                      onClick={() => setPlanningViewMode('timeline')}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                        planningViewMode === 'timeline'
                          ? 'bg-primary text-on-primary shadow-sm'
                          : 'text-on-surface-variant hover:text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">view_timeline</span>
                      Timeline
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenScaleGenerator}
                    className="h-10 px-4 bg-primary text-on-primary rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-primary-dim transition-all shadow-sm whitespace-nowrap"
                  >
                    + Nova Escala
                  </button>
                </div>
              </div>

              {/* Linha 2: Busca, Setor, popover Filtros e dropdown Ações */}
              <div className="pt-3 border-t border-outline-variant/10 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
                <div className="flex flex-col sm:flex-row gap-2.5 flex-1 min-w-0">
                  <div className="relative flex-1 min-w-0 sm:max-w-sm">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant/70 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true">search</span>
                    <input
                      type="text"
                      aria-label="Buscar funcionário"
                      value={employeeSearchTerm}
                      onChange={(event) => setEmployeeSearchTerm(event.target.value)}
                      placeholder="Buscar funcionário..."
                      className="w-full h-10 pl-9 pr-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm text-on-surface focus:ring-1 focus:ring-primary outline-none transition-all"
                    />
                  </div>

                  <select
                    aria-label="Setor"
                    value={filterRole}
                    onChange={(event) => setFilterRole(event.target.value)}
                    className="h-10 sm:w-48 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                  >
                    <option value="all">Setor: Todos</option>
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

                <div className="flex flex-wrap items-center gap-2">
                  {/* Popover Filtros (Status, Turno e Carga Semanal) */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={filtrosAberto}
                      onClick={() => { setFiltrosAberto((v) => !v); setAcoesAberto(false); }}
                      className={`h-10 px-3.5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                        filtrosAtivosCount > 0 || filtrosAberto
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">tune</span>
                      Filtros
                      {filtrosAtivosCount > 0 && (
                        <span className="rounded-full bg-primary text-on-primary text-[10px] px-1.5 py-0.5 leading-none">{filtrosAtivosCount}</span>
                      )}
                    </button>

                    {filtrosAberto && (
                      <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-xl p-4 z-40 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-on-surface">Filtros</span>
                          <button type="button" onClick={() => setFiltrosAberto(false)} aria-label="Fechar filtros" className="p-1 rounded-lg text-on-surface-variant hover:text-primary">
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
                          </button>
                        </div>

                        <div>
                          <label htmlFor="rh-filtro-status" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-1">Status</label>
                          <select
                            id="rh-filtro-status"
                            value={filterStatus}
                            onChange={(event) => setFilterStatus(event.target.value as 'all' | 'folgaHoje')}
                            className="w-full h-10 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                          >
                            <option value="all">Todos</option>
                            <option value="folgaHoje">Folga hoje</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="rh-filtro-turno" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-1">Turno</label>
                          <select
                            id="rh-filtro-turno"
                            value={planningShiftFilter}
                            onChange={(event) => setPlanningShiftFilter(event.target.value as 'all' | 'manha' | 'tarde' | 'noite' | 'comercial' | 'folga')}
                            className="w-full h-10 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                          >
                            <option value="all">Todos</option>
                            <option value="manha">Manhã</option>
                            <option value="tarde">Tarde</option>
                            <option value="noite">Noite</option>
                            <option value="comercial">Comercial</option>
                            <option value="folga">Folga</option>
                          </select>
                        </div>

                        <div>
                          <label htmlFor="rh-filtro-carga" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-1">Carga Semanal</label>
                          <select
                            id="rh-filtro-carga"
                            value={planningWorkloadFilter}
                            onChange={(event) => setPlanningWorkloadFilter(event.target.value as 'all' | 'ate36' | '37a44' | '45plus')}
                            className="w-full h-10 bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 text-sm text-on-surface"
                          >
                            <option value="all">Todas</option>
                            <option value="ate36">Até 36h</option>
                            <option value="37a44">37h a 44h</option>
                            <option value="45plus">45h ou mais</option>
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setFilterStatus('all');
                            setPlanningDateScope('mensal');
                            setPlanningWeekIndex(1);
                            setPlanningEmployeeFilter('all');
                            setPlanningShiftFilter('all');
                            setPlanningWorkloadFilter('all');
                            setFiltrosAberto(false);
                          }}
                          className="w-full h-9 px-3 rounded-xl border border-outline-variant/20 bg-surface-container-low text-xs font-bold uppercase tracking-wider text-on-surface-variant hover:text-primary transition-colors"
                        >
                          Limpar Filtros
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Dropdown Ações (Repetir mês anterior, Edição em lote, Ocultar alertas) */}
                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={acoesAberto}
                      onClick={() => { setAcoesAberto((v) => !v); setFiltrosAberto(false); }}
                      className={`h-10 px-3.5 rounded-xl border text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                        acoesAberto
                          ? 'bg-primary/15 text-primary border-primary/30'
                          : 'bg-surface-container-low text-on-surface-variant border-outline-variant/20 hover:text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">more_horiz</span>
                      Ações
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">expand_more</span>
                    </button>

                    {acoesAberto && (
                      <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest shadow-xl p-1.5 z-40 space-y-1">
                        {planningViewMode === 'calendario' && selectedScaleEmployee && (
                          <button
                            type="button"
                            onClick={() => { setAcoesAberto(false); abrirModelo('mesAnterior'); }}
                            className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container flex items-center gap-2 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">content_copy</span>
                            Repetir mês anterior
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setAcoesAberto(false); setIsBatchEditOpen(true); }}
                          className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container flex items-center gap-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">checklist</span>
                          Edição em lote
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAcoesAberto(false); setShowTopAlerts((prev) => !prev); }}
                          className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container flex items-center gap-2 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">{showTopAlerts ? 'notifications_off' : 'notifications'}</span>
                          {showTopAlerts ? 'Ocultar alertas' : 'Mostrar alertas'}
                        </button>
                      </div>
                    )}
                  </div>

                  {suggestedPlanningKeys.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleConfirmSuggestedScale}
                        disabled={isSavingPlanning}
                        className="h-10 px-4 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-wider hover:bg-primary-dim disabled:opacity-60 transition-colors"
                      >
                        {isSavingPlanning ? 'Confirmando...' : `Confirmar Escala (${suggestedPlanningKeys.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={handleDiscardSuggestedScale}
                        disabled={isSavingPlanning}
                        className="h-10 px-3.5 rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface-variant text-xs font-bold uppercase tracking-wider hover:text-error disabled:opacity-60 transition-colors"
                      >
                        Descartar Proposta
                      </button>
                    </>
                  )}
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
                        modo="editar"
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
                    isEditable
                    suggestedKeys={suggestedPlanningKeys}
                    overrides={planningOverridesList.filter((override) => override.data.startsWith(`${selectedScaleMonth}-`))}
                    onQuickToggleDay={pedirAlternarDia}
                    onQuickSetDay={pedirDefinirDia}
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
            tone={acaoPendente?.perigo ? 'danger' : 'primary'}
            icon={acaoPendente?.icone || 'edit_calendar'}
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

              <div role="dialog" aria-modal="true" aria-label="Gerar escala" className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-outline-variant/20 bg-surface-container shadow-2xl p-6">
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
                      <label htmlFor="gerador-colaborador" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Colaborador</label>
                      {/* Um seletor só: digitar filtra a lista; escolher fixa o nome no campo */}
                      <input
                        id="gerador-colaborador"
                        type="search"
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="gerador-colaborador-lista"
                        autoComplete="off"
                        value={scaleGeneratorSearch}
                        onChange={(event) => setScaleGeneratorSearch(event.target.value)}
                        placeholder={colaboradorDoGerador?.name || 'Buscar colaborador'}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface placeholder:text-on-surface"
                      />
                      <ul id="gerador-colaborador-lista" role="listbox" aria-label="Colaboradores" className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-low custom-scrollbar">
                        {filteredScaleGeneratorEmployees.length === 0 && <li className="px-3 py-2 text-xs text-on-surface-variant">Nenhum colaborador encontrado</li>}
                        {filteredScaleGeneratorEmployees.map((employee) => (
                          <li key={employee.id} role="option" aria-selected={employee.id === scaleGeneratorEmployeeId}>
                            <button
                              type="button"
                              onClick={() => { setScaleGeneratorEmployeeId(employee.id); setScaleGeneratorSearch(''); }}
                              className={`w-full text-left px-3 py-2 text-sm ${employee.id === scaleGeneratorEmployeeId ? 'bg-primary/15 text-primary font-bold' : 'text-on-surface hover:bg-surface-container'}`}
                            >
                              {employee.name}{employee.cargo ? <span className="text-xs text-on-surface-variant"> · {employee.cargo}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
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

                  <div>
                    <label htmlFor="gerador-turno" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Turno padrão</label>
                    {turnosCadastrados.length === 0 ? (
                      <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                        Nenhum turno cadastrado. Cadastre em Profissionais e Cargos &gt; Regras e Turnos antes de gerar a escala, para os dias não ficarem sem horário.
                      </p>
                    ) : (
                      <select
                        id="gerador-turno"
                        required
                        value={scaleGeneratorTurno}
                        onChange={(event) => setScaleGeneratorTurno(event.target.value)}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      >
                        <option value="">Escolha o turno</option>
                        {scaleGeneratorTurno && !turnosCadastrados.some((t) => `${t.inicio}-${t.fim}` === scaleGeneratorTurno) && (
                          <option value={scaleGeneratorTurno}>Atual · {scaleGeneratorTurno.replace('-', '–')}</option>
                        )}
                        {turnosCadastrados.map((t) => <option key={t.id} value={`${t.inicio}-${t.fim}`}>{t.nome} · {t.inicio}–{t.fim}</option>)}
                      </select>
                    )}
                    <p className="mt-1 text-[11px] text-on-surface-variant">Vale para todos os dias de trabalho; o ajuste de um dia na grade continua tendo prioridade.</p>
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
                      <label htmlFor="gerador-domingos" className="block text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-2">Regra de Domingos</label>
                      <select
                        id="gerador-domingos"
                        title={scaleGeneratorSundayFrequency === '1x1' ? '1 domingo de folga a cada 1 trabalhado' : '1 domingo de folga a cada 2 trabalhados'}
                        value={scaleGeneratorSundayFrequency}
                        onChange={(event) => setScaleGeneratorSundayFrequency(event.target.value as '1x1' | '2x1')}
                        className="w-full h-11 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-sm text-on-surface"
                      >
                        <option value="1x1">1x1 · folga a cada domingo trabalhado</option>
                        <option value="2x1">2x1 · folga a cada 2 domingos</option>
                      </select>
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-xs text-on-surface-variant">
                  A geração grava o turno escolhido nos dias de trabalho deste mês, preserva férias e afastamentos e não altera meses anteriores.
                </p>

                <div className="mt-4 pt-4 border-t border-outline-variant/10 flex items-center justify-between gap-3">
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
                    disabled={!scaleGeneratorEmployeeId || isSavingPlanning || !scaleGeneratorTurno}
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
