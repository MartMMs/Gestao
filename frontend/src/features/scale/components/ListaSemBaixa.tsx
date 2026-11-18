import React, { useMemo } from 'react';
import { dataBR, instanteNoFuso } from '@shared/agenda';
import { semBaixaVencido } from '@shared/statusAgendamento';
import type { Appointment, Employee, Service } from '../../../types';
import { getDuration } from '../../appointments/utils/appointmentCore';

/** Atendimentos que já terminaram e ninguém concluiu nem marcou falta (mesma regra da grade e do relatório), do mais antigo */
export const atendimentosSemBaixa = (appointments: Appointment[], services: Service[], agora: Date) => appointments
  .filter((app) => semBaixaVencido({ status: app.status, inicio: instanteNoFuso(app.date, app.time), servicos: [{ duracao: getDuration(app.services, services) }] }, agora))
  .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

// shortcut: o relógio só é relido quando a agenda muda; um atendimento que acabou agora entra na próxima atualização
export const useSemBaixa = (appointments: Appointment[], services: Service[]) =>
  useMemo(() => atendimentosSemBaixa(appointments, services, new Date()), [appointments, services]);

export function ListaSemBaixa({ itens, employees, onAbrir }: { itens: Appointment[]; employees: Employee[]; onAbrir: (app: Appointment) => void }) {
  const nomes = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  return (
    <section id="lista-sem-baixa" aria-label="Atendimentos sem baixa" className="mb-4 shrink-0 rounded-2xl border border-error/30 bg-error/5 p-3">
      <p className="text-xs text-on-surface-variant mb-2">Já terminaram e ninguém concluiu nem marcou falta. Abra cada um para dar baixa.</p>
      <ul className="max-h-60 overflow-y-auto divide-y divide-outline-variant/20">
        {itens.map((app) => (
          <li key={app.id}>
            <button type="button" onClick={() => onAbrir(app)} className="w-full text-left py-2 px-1 flex flex-wrap gap-x-3 text-sm hover:bg-error/10 rounded-lg">
              <span className="font-bold">{dataBR(app.date)} {app.time}</span>
              <span>{app.clientName}</span>
              <span className="text-on-surface-variant">{nomes.get(app.assignedEmployeeId) ?? 'Profissional'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
