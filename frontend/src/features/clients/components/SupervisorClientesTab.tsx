import React, { useMemo, useState } from 'react';
import { normalizarTexto } from '@shared/validadores';
import { motion } from 'motion/react';
import { Appointment, Client, Service } from '../../../types';
import { AnamneseForm, AnamneseData } from '../../../components/AnamneseForm';
import { formatAnamneseStorage, parseClientObservation } from '../../../utils/anamneseUtils';
import { useSearch } from '../../../hooks/useSearch';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { formatCpf, formatPhone } from '../../../utils/formatters';
import { getLocalTodayString } from '../../appointments/utils/appointmentCore';
import { useAuth } from '../../../AuthContext';
import { useClientAppointments } from '../../../api';
import { LIMITE_HISTORICO_CLIENTE } from '@shared/agendaJanela';
import { valorDoAtendimento } from '../../../utils/valorAtendimento';

interface SupervisorClientesTabProps {
  clients: Client[];
  appointments: Appointment[];
  services: Service[];
  onEditClient?: (id: string, clientData: Partial<Client>) => Promise<boolean | void> | void;
  onDeleteClient?: (id: string) => Promise<unknown> | void;
  // Colaboradores só editam a anamnese; dados cadastrais ficam com supervisores
  somenteAnamnese?: boolean;
  setToastMessage?: (msg: string | null) => void;
}

const ITEMS_PER_PAGE = 10;

export function SupervisorClientesTab({ clients, appointments, services, onEditClient, onDeleteClient, somenteAnamnese = false, setToastMessage }: SupervisorClientesTabProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingClientNote, setEditingClientNote] = useState('');
  const [editingClientAlergias, setEditingClientAlergias] = useState('');
  const [editingClientPreferencias, setEditingClientPreferencias] = useState('');
  const [clientToDelete, setClientToDelete] = useState<string | null>(null);
  const [summaryClient, setSummaryClient] = useState<{ id: string; name: string; note: string; items: string[]; data: AnamneseData } | null>(null);
  const [editingAnamneseClient, setEditingAnamneseClient] = useState<{ id: string; name: string; note: string; data: AnamneseData } | null>(null);
  const [historyClient, setHistoryClient] = useState<Client | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'all' | '7days' | 'month'>('all');

  // A agenda carregada cobre só o último ano; o histórico aberto busca o período todo do cliente
  const { token } = useAuth();
  const { data: fullClientAppointments, isLoading: loadingClientHistory, isError: clientHistoryError } = useClientAppointments(token, historyClient?.id ?? null);

  const filteredClients = useSearch(clients, searchTerm, (client) => [client.nome, client.telefone, client.cpf, client.codigo ? `#${client.codigo}` : undefined]);

  const normalizeValue = (value?: string) => normalizarTexto(value);
  const digitsOnly = (value?: string) => (value || '').replace(/\D/g, '');

  const getClientHistory = (client: Client) => {
    const clientName = normalizeValue(client.nome);
    const clientPhone = digitsOnly(client.telefone);
    const clientCpf = digitsOnly(client.cpf);

    // Junta o histórico completo (vindo do servidor) com a agenda já carregada, sem repetir
    const byId = new Map<string, Appointment>();
    for (const appointment of [...(fullClientAppointments || []), ...appointments]) byId.set(appointment.id, appointment);

    return Array.from(byId.values())
      .filter((appointment) => {
        if (appointment.clientId && appointment.clientId === client.id) return true;

        const appName = normalizeValue(appointment.clientName);
        const appPhone = digitsOnly(appointment.contact);
        const appCpf = digitsOnly(appointment.cpf);

        if (clientCpf && appCpf && clientCpf === appCpf) return true;
        if (clientPhone && appPhone && clientPhone === appPhone) return true;
        return clientName.length > 0 && appName === clientName;
      })
      .sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}:00`).getTime() - new Date(`${a.date}T${a.time || '00:00'}:00`).getTime());
  };

  const getFilteredHistory = (history: Appointment[]) => {
    if (historyFilter === 'all') return history;

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (historyFilter === '7days') {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      return history.filter((appointment) => {
        const date = new Date(`${appointment.date}T12:00:00`);
        return date >= sevenDaysAgo && date <= today;
      });
    }

    return history.filter((appointment) => {
      const date = new Date(`${appointment.date}T12:00:00`);
      return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
    });
  };

  const getAppointmentValue = (appointment: Appointment) => valorDoAtendimento(appointment, services);

  const totalClients = filteredClients.length;
  const totalPages = Math.max(1, Math.ceil(totalClients / ITEMS_PER_PAGE));
  const currentClients = filteredClients.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const mostrarMensagem = (mensagem: string) => {
    setToastMessage?.(mensagem);
  };

  const mensagemDeErro = (error: unknown, padrao: string) => (error instanceof Error && error.message ? error.message : padrao);

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient || !onEditClient || isSaving) return;

    const parsedCurrent = parseClientObservation(editingClient.observacao);
    const finalObservation = formatAnamneseStorage(editingClientNote, parsedCurrent.anamData);

    setIsSaving(true);
    try {
      // Sem permissão de cadastro (colaborador), envia só a anamnese; telefone/CPF mascarados nunca voltam à API
      const resultado = await onEditClient(editingClient.id, somenteAnamnese
        ? { observacao: finalObservation }
        : {
          nome: editingClient.nome,
          telefone: editingClient.telefone,
          cpf: editingClient.cpf,
          observacao: finalObservation,
        });
      if (resultado === false) throw new Error('Não foi possível atualizar o cliente.');
      mostrarMensagem('Cliente atualizado!');
      setEditingClient(null);
      setEditingClientNote('');
      setEditingClientAlergias('');
      setEditingClientPreferencias('');
    } catch (error) {
      mostrarMensagem(mensagemDeErro(error, 'Não foi possível atualizar o cliente.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!clientToDelete || !onDeleteClient || isSaving) return;
    setIsSaving(true);
    try {
      const resultado = await onDeleteClient(clientToDelete);
      if (resultado === false) throw new Error('Não foi possível excluir o cliente.');
      // O servidor diz se o cadastro foi apagado ou só anonimizado (quando há histórico de atendimentos)
      const mensagem = (resultado as { mensagem?: unknown } | undefined)?.mensagem;
      mostrarMensagem(typeof mensagem === 'string' ? mensagem : 'Cliente excluído!');
      setClientToDelete(null);
    } catch (error) {
      mostrarMensagem(mensagemDeErro(error, 'Não foi possível excluir o cliente.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAnamnese = async () => {
    if (!editingAnamneseClient || !onEditClient) {
      setEditingAnamneseClient(null);
      return;
    }

    const finalObservation = formatAnamneseStorage(editingAnamneseClient.note, editingAnamneseClient.data);
    setIsSaving(true);
    try {
      const resultado = await onEditClient(editingAnamneseClient.id, { observacao: finalObservation });
      if (resultado === false) throw new Error('Não foi possível salvar a anamnese.');
      mostrarMensagem('Ficha de anamnese atualizada!');
      setEditingAnamneseClient(null);
    } catch (error) {
      mostrarMensagem(mensagemDeErro(error, 'Não foi possível salvar a anamnese.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant/10 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-2xl font-headline text-primary">Base de Clientes</h3>
            <p className="text-sm text-on-surface-variant">Gerencie o cadastro e historico dos seus clientes.</p>
          </div>
          <div className="relative w-full md:w-72">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline-variant">search</span>
            <input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full pl-12 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 text-sm rounded-xl focus:ring-1 focus:ring-primary text-on-surface"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest">Nome</th>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest">CPF</th>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest">Telefone</th>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest hidden lg:table-cell">Perfil Clínico</th>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest hidden md:table-cell">Observacoes</th>
                <th className="py-3 px-4 text-[10px] font-bold text-outline uppercase tracking-widest text-right">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {currentClients.map(client => (
                <tr key={client.id} className="border-t border-outline-variant/10 hover:bg-surface/50">
                  <td className="py-4 px-4 text-sm font-medium text-on-surface">{client.nome}{client.codigo ? <span className="ml-2 font-mono text-xs text-on-surface-variant">#{client.codigo}</span> : null}</td>
                  <td className="py-4 px-4 text-sm text-on-surface-variant">{client.cpf ? formatCpf(client.cpf) : '-'}</td>
                  <td className="py-4 px-4 text-sm text-on-surface-variant">{client.telefone ? formatPhone(client.telefone) : '-'}</td>
                  <td className="py-4 px-4 text-xs hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {client.alergias && client.alergias.length > 0 && <span className="bg-error/10 text-error px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[8px] flex items-center gap-1"><span className="material-symbols-outlined text-[10px]">medical_information</span> Alergias</span>}
                      {client.preferencias && client.preferencias.length > 0 && <span className="bg-tertiary/10 text-tertiary px-2 py-0.5 rounded font-bold uppercase tracking-wider text-[8px] flex items-center gap-1"><span className="material-symbols-outlined text-[10px]">favorite</span> Preferências</span>}
                      {!client.alergias?.length && !client.preferencias?.length && <span className="text-on-surface-variant opacity-50">-</span>}
                    </div>
                  </td>
                  <td className="py-4 px-4 text-xs text-on-surface-variant max-w-xs truncate hidden md:table-cell" title={parseClientObservation(client.observacao).note}>
                    {parseClientObservation(client.observacao).note || 'Nenhuma'}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setHistoryClient(client)}
                      className="p-2 text-on-surface-variant hover:text-primary rounded-full"
                      title="Histórico de serviços"
                    >
                      <span className="material-symbols-outlined text-xl">history</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const parsed = parseClientObservation(client.observacao);
                        setSummaryClient({ id: client.id, name: client.nome, note: parsed.note, items: parsed.anamSummary, data: parsed.anamData });
                      }}
                      className="p-2 text-on-surface-variant hover:text-primary rounded-full"
                      title="Resumo da ficha"
                    >
                      <span className="material-symbols-outlined text-xl">summarize</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditingClient(client);
                        setEditingClientNote(parseClientObservation(client.observacao).note);
                        setEditingClientAlergias((client.alergias || []).join(', '));
                        setEditingClientPreferencias((client.preferencias || []).join(', '));
                      }}
                      disabled={!onEditClient}
                      className="p-2 text-on-surface-variant hover:text-primary rounded-full disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-xl">edit</span>
                    </button>
                    <button
                      onClick={() => setClientToDelete(client.id)}
                      disabled={!onDeleteClient}
                      className="p-2 text-on-surface-variant hover:text-error rounded-full disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-xl">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredClients.length === 0 && (
          <div className="text-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-5xl opacity-50">person_search</span>
            <p className="mt-4 font-medium">Nenhum cliente encontrado.</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-6 pt-4 border-t border-outline-variant/10">
            <span className="text-xs text-on-surface-variant">
              Pagina <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({totalClients} clientes)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-full border border-outline-variant/20 text-on-surface-variant disabled:opacity-30 hover:bg-surface-container"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-full border border-outline-variant/20 text-on-surface-variant disabled:opacity-30 hover:bg-surface-container"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {editingClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-md w-full border border-outline-variant/20">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-headline text-primary">Editar Cliente</h2>
              <button onClick={() => setEditingClient(null)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Nome</label>
                <input
                  required
                  type="text"
                  value={editingClient.nome} readOnly={somenteAnamnese}
                  onChange={e => setEditingClient({ ...editingClient, nome: e.target.value })}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Telefone</label>
                <input
                  type="text"
                  value={editingClient.telefone || ''} readOnly={somenteAnamnese}
                  onChange={e => setEditingClient({ ...editingClient, telefone: formatPhone(e.target.value) })}
                  maxLength={15}
                  placeholder="(00) 00000-0000"
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">CPF</label>
                <input
                  type="text"
                  value={editingClient.cpf || ''} readOnly={somenteAnamnese}
                  onChange={e => setEditingClient({ ...editingClient, cpf: formatCpf(e.target.value) })}
                  maxLength={14}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Alergias e Restrições (Separado por vírgula)</label>
                <input type="text" value={editingClientAlergias} onChange={e => setEditingClientAlergias(e.target.value)} placeholder="Ex: Óleo de Amêndoas, Lavanda" className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Preferências (Separado por vírgula)</label>
                <input type="text" value={editingClientPreferencias} onChange={e => setEditingClientPreferencias(e.target.value)} placeholder="Ex: Pressão Forte, Chá Verde" className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Observacoes</label>
                <textarea
                  rows={3}
                  value={editingClientNote}
                  onChange={e => setEditingClientNote(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 text-sm focus:ring-1 focus:ring-primary outline-none text-on-surface resize-none"
                />
              </div>
              <button type="submit" className="w-full bg-primary text-on-primary py-3 rounded-xl font-bold text-xs uppercase tracking-[0.2em] shadow-sm hover:bg-primary-dim transition-all">
                Salvar Alteracoes
              </button>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(clientToDelete)}
        title="Excluir Cliente?"
        description="Clientes com atendimentos marcados não podem ser excluídos. Se houver histórico, nome, contato, CPF e ficha de saúde são apagados e os atendimentos ficam sem identificação. Não pode ser desfeito."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        icon="warning"
        onClose={() => setClientToDelete(null)}
        onConfirm={handleDeleteConfirm}
      />

      {summaryClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-xl w-full border border-outline-variant/20">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-headline text-primary">Resumo da Ficha</h2>
              <button onClick={() => setSummaryClient(null)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">Cliente: <strong className="text-on-surface">{summaryClient.name}</strong></p>
            {summaryClient.items.length === 0 ? (
              <p className="text-sm text-on-surface-variant">Nenhuma ficha de anamnese registrada para este cliente.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                {summaryClient.items.map((item, idx) => (
                  <div key={`anam-${idx}`} className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-3 py-2 text-sm text-on-surface">
                    {item}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingAnamneseClient({ id: summaryClient.id, name: summaryClient.name, note: summaryClient.note, data: summaryClient.data });
                  setSummaryClient(null);
                }}
                disabled={!onEditClient}
                className="px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-bold uppercase tracking-widest hover:bg-surface-container-high transition-colors disabled:opacity-40"
              >
                Alterar Ficha
              </button>
              <button onClick={() => setSummaryClient(null)} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:bg-primary-dim transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {editingAnamneseClient && (
        <AnamneseForm
          data={editingAnamneseClient.data}
          onChange={(data) => setEditingAnamneseClient(prev => (prev ? { ...prev, data } : prev))}
          onClose={handleSaveAnamnese}
        />
      )}

      {historyClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-container-lowest p-8 rounded-3xl shadow-xl max-w-2xl w-full border border-outline-variant/20 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-headline text-primary">Histórico de Serviços</h2>
              <button onClick={() => setHistoryClient(null)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-sm text-on-surface-variant mb-5">Cliente: <strong className="text-on-surface">{historyClient.nome}</strong></p>

            <div className="flex flex-wrap gap-2 mb-4">
              <button
                type="button"
                onClick={() => setHistoryFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest ${historyFilter === 'all' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:text-primary'}`}
              >
                Todo período
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilter('7days')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest ${historyFilter === '7days' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:text-primary'}`}
              >
                7 dias
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilter('month')}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest ${historyFilter === 'month' ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:text-primary'}`}
              >
                Mês atual
              </button>
            </div>

            {loadingClientHistory && (
              <p className="text-xs text-on-surface-variant mb-3">Carregando histórico completo...</p>
            )}
            {fullClientAppointments && fullClientAppointments.length >= LIMITE_HISTORICO_CLIENTE && (
              <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mb-3">
                Exibindo os {LIMITE_HISTORICO_CLIENTE} atendimentos mais recentes: totais e faltas consideram só esse período.
              </p>
            )}
            {clientHistoryError && (
              <p className="text-xs text-error bg-error/10 border border-error/20 rounded-xl px-3 py-2 mb-3">
                Não foi possível carregar o histórico completo. Abaixo, só os atendimentos do último ano.
              </p>
            )}
            {(() => {
              const fullHistory = getClientHistory(historyClient);
              const filteredHistory = getFilteredHistory(fullHistory);
              const completedFiltered = filteredHistory.filter((appointment) => appointment.status === 'completed');
              const todayStr = getLocalTodayString();
              const noShows = filteredHistory.filter((appointment) => appointment.status !== 'completed' && appointment.date < todayStr);
              const totalSpent = completedFiltered.reduce((sum, appointment) => sum + getAppointmentValue(appointment), 0);

              return (
                <>
                  <div className="bg-surface-container-low p-5 rounded-2xl border border-outline-variant/20 mb-6 flex flex-col md:flex-row gap-6">
                     <div className="flex-1">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-outline mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">medical_information</span> Alergias & Restrições</h4>
                        {historyClient.alergias?.length ? (
                           <div className="flex flex-wrap gap-1.5">
                             {historyClient.alergias.map(a => <span key={a} className="bg-error/10 text-error px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">{a}</span>)}
                           </div>
                        ) : <p className="text-xs text-on-surface-variant">Nenhuma restrição declarada.</p>}
                     </div>
                     <div className="flex-1 border-t md:border-t-0 md:border-l border-outline-variant/20 pt-4 md:pt-0 md:pl-6">
                        <h4 className="text-xs font-bold uppercase tracking-widest text-outline mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">favorite</span> Preferências</h4>
                        {historyClient.preferencias?.length ? (
                           <div className="flex flex-wrap gap-1.5">
                             {historyClient.preferencias.map(p => <span key={p} className="bg-tertiary/10 text-tertiary px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">{p}</span>)}
                           </div>
                        ) : <p className="text-xs text-on-surface-variant">Nenhuma preferência declarada.</p>}
                     </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                    <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant truncate">Concluídos</p>
                      <p className="text-lg font-headline text-primary">{completedFiltered.length}</p>
                    </div>
                    <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant truncate">Receita LTV</p>
                      <p className="text-lg font-headline text-primary">
                        {totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </p>
                    </div>
                    <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl px-4 py-3 col-span-2 sm:col-span-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant truncate">Taxa de Faltas (No-Show)</p>
                      <p className={`text-lg font-headline ${noShows.length > 0 ? 'text-error' : 'text-on-surface'}`}>{noShows.length} Faltas</p>
                    </div>
                  </div>

                  {filteredHistory.length === 0 ? (
                    <p className="text-sm text-on-surface-variant">Nenhum serviço encontrado para este cliente no período selecionado.</p>
                  ) : (
                    <div className="space-y-3">
                      {filteredHistory.map((appointment) => (
                        <div key={appointment.id} className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-4">
                          <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-sm font-bold text-on-surface">{appointment.date.split('-').reverse().join('/')} {appointment.time}</p>
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full ${appointment.status === 'completed' ? 'bg-primary/15 text-primary' : appointment.status === 'no_show' ? 'bg-error/10 text-error' : 'bg-surface-container-high text-on-surface-variant'}`}>
                              {appointment.status === 'completed' ? 'Concluído' : appointment.status === 'no_show' ? 'Faltou' : 'Agendado'}
                            </span>
                          </div>
                          <p className="text-sm text-on-surface">{appointment.services.join(', ') || 'Sem serviço informado'}</p>
                          <p className="text-xs text-on-surface-variant mt-1">
                            Valor estimado: {getAppointmentValue(appointment).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

            <div className="mt-6 flex justify-end">
              <button onClick={() => { setHistoryClient(null); setHistoryFilter('all'); }} className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold uppercase tracking-widest hover:bg-primary-dim transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
