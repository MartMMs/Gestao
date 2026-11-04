import React, { useEffect, useMemo, useState } from 'react';
import { Appointment, Employee, Service } from '../../../types';
import { AppointmentScheduleFields } from '../../../components/AppointmentScheduleFields';
import { AppointmentModalShell } from '../../../components/AppointmentModalShell';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { validateAppointmentScheduling } from '../utils/appointmentValidation';
import { ehVersaoDesatualizada, isApiError, useCheckinAppointment, useClients } from '../../../api';
import { normalizarNome } from '@shared/validadores';
import { CODIGO_FORA_DA_AGENDA, statusFechado } from '@shared/statusAgendamento';
import { useAuth } from '../../../AuthContext';
import { formatPhone } from '../../../utils/formatters';
import { useFormDraft } from '../../../hooks/useFormDraft';

export interface EditAppointmentModalProps {
  appointment: Appointment;
  employees: Employee[];
  services: Service[];
  appointments: Appointment[];
  onClose: () => void;
  onEditAppointment?: (id: string, appointment: Partial<Appointment>) => Promise<boolean | void> | void;
  setErrorMessage: (msg: string | null) => void;
  setToastMessage: (msg: string | null) => void;
}

const paraFormulario = (app: Appointment): Appointment => ({
  ...app,
  contact: app.contact && /\d/.test(app.contact) ? formatPhone(app.contact) : app.contact,
});

// Nomes dos campos para avisar o que a outra pessoa mudou
const ROTULO_CAMPO: Partial<Record<keyof Appointment, string>> = {
  date: 'data', time: 'horário', assignedEmployeeId: 'profissional', services: 'serviços', clientName: 'cliente', clientId: 'cliente',
  contact: 'contato', cpf: 'CPF', observation: 'observações', status: 'situação',
};
const CAMPOS_IGNORADOS = new Set<string>(['version']);
const MENSAGEM_SAIU_DA_AGENDA = 'Este agendamento saiu da sua agenda enquanto você editava (cancelado, excluído ou passado para outro profissional). Nada foi salvo.';
const camposDiferentes = (a: Appointment, b: Appointment) => (Object.keys({ ...a, ...b }) as (keyof Appointment)[])
  .filter((k) => !CAMPOS_IGNORADOS.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));

export function EditAppointmentModal({ appointment, employees, services, appointments, onClose, onEditAppointment, setErrorMessage, setToastMessage }: EditAppointmentModalProps) {
  const [original, setOriginal] = useState<Appointment>(() => paraFormulario(appointment));
  // Rascunho por agendamento E versão: se a sessão expirar no meio da edição, o que foi digitado volta ao reabrir;
  // se o agendamento mudou no servidor nesse meio tempo, o rascunho antigo é ignorado (não sobrescreve o novo).
  // Fechar ou salvar apaga o rascunho.
  const { draft: editingAppointment, setDraft: setEditingAppointment, clearDraft } = useFormDraft<Appointment>(
    `edit-appointment:${appointment.id}:${appointment.version ?? ''}`,
    original,
  );
  const [rascunhoRestaurado] = useState(() => JSON.stringify(editingAppointment) !== JSON.stringify(original));
  // Rascunho de uma versão anterior deste agendamento: alguém alterou no servidor, então ele é descartado com aviso
  const [rascunhoDescartado] = useState(() => {
    try {
      const atual = `rascunho:edit-appointment:${appointment.id}:${appointment.version ?? ''}`;
      const antigos = Object.keys(sessionStorage).filter((k) => k.startsWith(`rascunho:edit-appointment:${appointment.id}:`) && k !== atual);
      antigos.forEach((k) => sessionStorage.removeItem(k));
      return antigos.length > 0;
    } catch {
      return false;
    }
  });
  // Conflito de versão: espera a agenda recarregar e mescla (ver efeito abaixo)
  const [aguardandoVersaoNova, setAguardandoVersaoNova] = useState(false);
  const { token, currentUser } = useAuth();
  // Mesmas regras do servidor: nome do cliente só quem gerencia a agenda; telefone só a supervisão
  const supervisao = ['admin', 'supervisor'].includes(currentUser?.role ?? '');
  const gerenciaAgenda = supervisao || currentUser?.role === 'receptionist';
  const checkin = useCheckinAppointment(token);
  // Quem gerencia a agenda junta cadastros duplicados (ex.: o totem criou "Nome (tel. final 22)") digitando o nome
  // de um cadastro que já existe: o atendimento passa para ele, em vez de renomear este e dar conflito de homônimo
  const { data: carteira } = useClients(gerenciaAgenda ? token : null) as { data?: { id: string; nome: string; codigo?: number }[] };
  // Cadastro existente escolhido pelo nome: só passa o atendimento para ele depois de a pessoa confirmar
  const [trocaDeCadastro, setTrocaDeCadastro] = useState<{ id: string; nome: string; codigo?: number } | null>(null);
  // Nome que não bate com nenhum cadastro: salvar RENOMEIA a ficha atual (todos os atendimentos dela), então também confirma
  const [renomearCadastro, setRenomearCadastro] = useState(false);
  const podeFazerCheckin = appointment.aguardandoCheckin && appointment.status === 'scheduled' && gerenciaAgenda;
  const confirmarChegada = async () => {
    try {
      await checkin.mutateAsync(appointment.id);
      setToastMessage('Chegada confirmada. A ficha do cliente foi liberada para o profissional.');
      closeAndDiscard();
    } catch (error) {
      setErrorMessage(isApiError(error) ? error.message : 'Não foi possível confirmar a chegada do cliente.');
    }
  };
  const closeAndDiscard = () => {
    clearDraft();
    onClose();
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  // Concluído, falta ou cancelado é registro fechado: só as observações mudam (o servidor recusa o resto)
  const encerrado = statusFechado(editingAppointment.status);
  // Encerrado e com as observações protegidas: não sobra nada que esta pessoa possa mudar
  const nadaEditavel = encerrado && Boolean(editingAppointment.observacaoOculta);
  // Acompanha a base da mesclagem (setOriginal): senão, depois de um conflito, tudo pareceria alterado
  const estadoInicial = useMemo(() => JSON.stringify(original), [original]);
  const hasUnsavedChanges = JSON.stringify(editingAppointment) !== estadoInicial;

  // Chegou a versão de quem salvou antes: a tela passa a partir dela e reaplica por cima SÓ os campos que esta
  // pessoa mudou. Nada do que a outra pessoa gravou é desfeito sem aparecer, e o próximo Salvar leva a versão nova.
  useEffect(() => {
    if (!aguardandoVersaoNova) return;
    const atual = appointments.find((a) => a.id === original.id);
    // Sumiu da agenda: não há o que mesclar, e esperar travaria a tela
    if (!atual) {
      setErrorMessage(MENSAGEM_SAIU_DA_AGENDA);
      clearDraft();
      onClose();
      return;
    }
    if (atual.version === original.version) return;
    const novaBase = paraFormulario(atual);
    // Encerrado por outra pessoa (concluído ou falta): só as observações continuam editáveis, então só elas são
    // reaplicadas; horário, profissional e serviços que esta pessoa mudou não valem mais
    const encerradoAgora = !statusFechado(original.status) && statusFechado(atual.status);
    const deles = camposDiferentes(novaBase, original);
    // A outra pessoa passou o atendimento para outro cadastro: nome, telefone e CPF digitados aqui eram do antigo e,
    // reaplicados, renomeariam a ficha do novo cliente
    const clienteTrocado = deles.includes('clientId');
    const meus = camposDiferentes(editingAppointment, original).filter((c) => (!encerradoAgora || c === 'observation')
      && !(clienteTrocado && ['clientId', 'clientName', 'contact', 'cpf'].includes(c)));
    const mesclado = { ...novaBase } as Appointment;
    for (const campo of meus) (mesclado as unknown as Record<string, unknown>)[campo] = editingAppointment[campo];
    mesclado.version = novaBase.version;
    setOriginal(novaBase);
    setEditingAppointment(mesclado);
    setAguardandoVersaoNova(false);
    const nomes = (campos: (keyof Appointment)[]) => [...new Set(campos.map((c) => ROTULO_CAMPO[c] ?? 'outros dados'))].join(', ');
    const emComum = meus.filter((c) => deles.includes(c));
    setConflictMessage(encerradoAgora
      ? 'Outra pessoa encerrou este atendimento (concluído ou falta) enquanto você editava. Suas observações continuam na tela; '
        + 'horário, profissional e serviços não podem mais mudar. Confira e salve de novo.'
      : `Outra pessoa salvou este agendamento enquanto você editava${deles.length ? ` (mudou: ${nomes(deles)})` : ''}. `
      + 'A tela agora mostra a versão dela com as suas alterações por cima'
      + (emComum.length ? `; atenção, vocês dois mudaram: ${nomes(emComum)} (ficou o seu)` : '')
      + '. Confira e salve de novo.',
    );
  }, [aguardandoVersaoNova, appointments, original, editingAppointment, setEditingAppointment, setErrorMessage, clearDraft, onClose]);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConflictMessage(null);
    // Nada mudou: fechar sem gravar (gravar avançaria a versão e derrubaria quem edita em outra aba)
    if (!hasUnsavedChanges) {
      closeAndDiscard();
      return;
    }
    if (!encerrado) {
      const scheduleValidationError = validateAppointmentScheduling({
        date: editingAppointment.date,
        time: editingAppointment.time,
        employeeId: editingAppointment.assignedEmployeeId,
        serviceNames: editingAppointment.services,
        appointments,
        services,
        ignoreAppointmentId: editingAppointment.id,
        permitirPassado: editingAppointment.date === appointment.date && editingAppointment.time === appointment.time,
      });

      if (scheduleValidationError) {
        setErrorMessage(scheduleValidationError);
        return;
      }
    }
    if (!onEditAppointment || isSubmitting) return;
    if (!editingAppointment.clientName.trim()) {
      setErrorMessage('Informe o nome do cliente.');
      return;
    }

    const outroCadastro = gerenciaAgenda && editingAppointment.clientName !== original.clientName
      ? carteira?.find((c) => c.id !== original.clientId && normalizarNome(c.nome) === normalizarNome(editingAppointment.clientName))
      : undefined;
    if (outroCadastro) {
      // Telefone e CPF passam a ser os do cadastro escolhido: uma mudança deles digitada aqui não seria aplicada
      if (editingAppointment.contact !== original.contact || editingAppointment.cpf !== original.cpf) {
        setErrorMessage(`"${outroCadastro.nome}" já é um cadastro: o atendimento passaria para ele, com o telefone e o CPF dele. Desfaça a mudança de telefone/CPF aqui (ajuste-os na aba Clientes) e salve de novo.`);
        return;
      }
      setTrocaDeCadastro(outroCadastro);
      return;
    }
    if (gerenciaAgenda && normalizarNome(editingAppointment.clientName) !== normalizarNome(original.clientName)) {
      setRenomearCadastro(true);
      return;
    }
    await salvar(editingAppointment, 'Agendamento atualizado!');
  };

  const salvar = async (envio: Partial<Appointment>, aviso: string) => {
    if (!onEditAppointment) return;
    setIsSubmitting(true);
    try {
      const success = await onEditAppointment(editingAppointment.id, envio);
      if (success !== false) { closeAndDiscard(); setToastMessage(aviso); }
    } catch (error) {
      if (ehVersaoDesatualizada(error)) {
        setAguardandoVersaoNova(true);
        setConflictMessage('Outra pessoa (ou outra aba) salvou este agendamento enquanto você editava. Carregando a versão dela...');
        return;
      }
      if (isApiError(error) && error.status === 409) {
        setConflictMessage(error.message || 'Conflito de horário detectado. Ajuste os dados e tente novamente.');
        return;
      }

      // Excluído (404) ou passado para outro profissional (403 com código próprio): saiu da agenda desta pessoa
      if (isApiError(error) && (error.status === 404 || error.code === CODIGO_FORA_DA_AGENDA)) {
        setErrorMessage(MENSAGEM_SAIU_DA_AGENDA);
        closeAndDiscard();
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o agendamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (<>
    <AppointmentModalShell
      showSubmitButton={!nadaEditavel}
      title="Editar Agendamento"
      onClose={closeAndDiscard}
      hasUnsavedChanges={hasUnsavedChanges}
      onSubmit={handleEditSubmit}
      submitLabel="Salvar Alterações"
      isSubmitting={isSubmitting}
      submitDisabled={isSubmitting}
      submittingLabel="Salvando..."
      alertBanner={<>{conflictMessage && (
        <div className="mb-4 rounded-2xl border border-error/30 bg-error/10 p-3 text-xs text-on-surface">
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[16px] text-error mt-0.5">schedule</span>
            <div>
              <p className="font-bold text-error uppercase tracking-[0.12em] text-[10px]">Atenção</p>
              <p className="text-on-surface-variant mt-1">{conflictMessage}</p>
            </div>
          </div>
        </div>
      )}{podeFazerCheckin && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary/10 p-3 text-xs text-on-surface flex gap-3 items-center justify-between">
          <span>Reserva feita no totem. A ficha de saúde só fica disponível ao profissional depois que a recepção confirmar a chegada do cliente.</span>
          <button type="button" onClick={confirmarChegada} disabled={checkin.isPending} className="shrink-0 rounded-full bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-on-primary disabled:opacity-60">
            {checkin.isPending ? 'Confirmando...' : 'Confirmar chegada'}
          </button>
        </div>
      )}{rascunhoDescartado && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-on-surface flex gap-2 items-center">
          <span className="material-symbols-outlined text-[16px] text-amber-600">history</span>
          <span>Suas alterações não salvas foram descartadas porque este agendamento foi modificado por outra pessoa. Confira os dados atuais.</span>
        </div>
      )}{rascunhoRestaurado && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-on-surface flex gap-2 items-center">
          <span className="material-symbols-outlined text-[16px] text-amber-600">history</span>
          <span>Rascunho restaurado: estas são as alterações que você não chegou a salvar. Cancele para descartá-las.</span>
        </div>
      )}</>}
      infoBanner={encerrado ? (
        <div className="bg-secondary-container/50 text-on-secondary-container p-3 rounded-xl text-xs flex gap-2 items-center mb-4">
          <span className="material-symbols-outlined text-[16px]">info</span>
          <span>
            {editingAppointment.status === 'no_show' ? 'Este atendimento está marcado como falta' : editingAppointment.status === 'cancelled' ? 'Este atendimento foi cancelado' : 'Este atendimento já foi concluído'}:
            {nadaEditavel
              ? ' as observações são protegidas (só quem tem acesso à ficha de saúde deste cliente as altera), então não há o que ajustar aqui.'
              : ' só as observações podem ser ajustadas. Para mudar horário, profissional ou serviços, reabra-o na agenda.'}
          </span>
        </div>
      ) : undefined}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-2">Cliente</label><input required type="text" value={editingAppointment.clientName} onChange={e => setEditingAppointment(p => p && ({...p, clientName: e.target.value}))} disabled={encerrado || !gerenciaAgenda} title={!gerenciaAgenda ? 'Só a supervisão altera o cliente do atendimento.' : undefined} list={gerenciaAgenda ? 'edit-appointment-clientes' : undefined} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm ${encerrado || !gerenciaAgenda ? 'opacity-50 cursor-not-allowed' : ''}`} />
          {gerenciaAgenda && !encerrado && (<>
            <datalist id="edit-appointment-clientes">
              {carteira?.map((c) => <option key={c.id} value={c.nome} />)}
            </datalist>
            <p className="mt-1 text-[10px] text-on-surface-variant">Escolha um cadastro existente para passar o atendimento para ele (ex.: juntar um cadastro duplicado).</p>
          </>)}</div>
        <div><label className="block text-[10px] font-bold text-on-surface-variant uppercase mb-2">Telefone</label><input type="text" value={editingAppointment.contact} onChange={e => setEditingAppointment(p => p && ({...p, contact: formatPhone(e.target.value)}))} maxLength={15} placeholder="(00) 00000-0000" disabled={encerrado || !supervisao} title={!supervisao ? 'Só a supervisão altera o telefone de um cliente já cadastrado.' : undefined} className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm ${encerrado || !supervisao ? 'opacity-50 cursor-not-allowed' : ''}`} /></div>
      </div>
      <AppointmentScheduleFields
        date={editingAppointment.date}
        time={editingAppointment.time}
        employeeId={editingAppointment.assignedEmployeeId}
        selectedServices={editingAppointment.services}
        details={editingAppointment.observation || ''}
        employees={employees}
        services={services}
        onDateChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, date: value }));
        }}
        onTimeChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, time: value }));
        }}
        onEmployeeChange={(value) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({ ...p, assignedEmployeeId: value }));
        }}
        onToggleService={(serviceName) => {
          setConflictMessage(null);
          setEditingAppointment(p => p && ({
            ...p,
            services: p.services.includes(serviceName) ? p.services.filter(item => item !== serviceName) : [...p.services, serviceName],
          }));
        }}
        onDetailsChange={(value) => setEditingAppointment(p => p && ({ ...p, observation: value }))}
        detailsDisabled={editingAppointment.observacaoOculta}
        detailsPlaceholder={editingAppointment.observacaoOculta ? 'Observações protegidas: só quem tem acesso à ficha de saúde deste cliente vê e altera.' : undefined}
        disabled={encerrado}
      />
    </AppointmentModalShell>
    <ConfirmDialog
      open={Boolean(trocaDeCadastro)}
      tone="primary"
      icon="person_search"
      title="Passar o atendimento para outro cadastro?"
      description={trocaDeCadastro ? `"${trocaDeCadastro.nome}"${trocaDeCadastro.codigo ? ` (código #${trocaDeCadastro.codigo})` : ''} já está cadastrado. O atendimento passa para esse cadastro (com o telefone, o CPF e a ficha dele); o cadastro atual não é renomeado. Use isto para juntar um cadastro duplicado. Se a cliente trocou de telefone, atualize-o na aba Clientes, senão o totem cria outro cadastro na próxima reserva.` : undefined}
      confirmLabel="Passar para esse cadastro"
      isSubmitting={isSubmitting}
      onClose={() => setTrocaDeCadastro(null)}
      onConfirm={async () => {
        const alvo = trocaDeCadastro;
        if (!alvo) return;
        setTrocaDeCadastro(null);
        // Contato e CPF ficam os do cadastro escolhido (os deste formulário são do cadastro antigo)
        await salvar({ ...editingAppointment, clientId: alvo.id, clientName: alvo.nome, contact: undefined, cpf: undefined },
          `Atendimento passado para o cadastro de ${alvo.nome}${alvo.codigo ? ` (#${alvo.codigo})` : ''}.`);
      }}
    />
    <ConfirmDialog
      open={renomearCadastro}
      tone="primary"
      icon="edit"
      title="Renomear o cadastro do cliente?"
      description={`Nenhum cadastro se chama "${editingAppointment.clientName.trim()}". Salvar renomeia o cadastro "${original.clientName}" (vale para todos os atendimentos dele). Para juntar com outro cadastro, escolha o nome na lista do campo Cliente.`}
      confirmLabel="Renomear e salvar"
      isSubmitting={isSubmitting}
      onClose={() => setRenomearCadastro(false)}
      onConfirm={async () => {
        setRenomearCadastro(false);
        await salvar(editingAppointment, 'Agendamento atualizado e cadastro renomeado.');
      }}
    />
  </>);
}