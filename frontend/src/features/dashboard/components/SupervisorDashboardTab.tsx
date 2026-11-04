import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Appointment, Employee, Service } from '../../../types';
import { getBrazilCurrentTimeString, getLocalTodayString } from '../../../features/appointments/utils/appointmentCore';
import { valorDoAtendimento } from '../../../utils/valorAtendimento';
import { useRelatorioFinanceiro } from '../../../api';
import { useAuth } from '../../../AuthContext';
import { hojeNoNegocio, periodoRapido } from '../../../utils/periodos';

interface SupervisorDashboardTabProps {
  appointments: Appointment[];
  services: Service[];
  employees: Employee[];
}

export function SupervisorDashboardTab({ appointments, services, employees }: SupervisorDashboardTabProps) {
  const [revenueFilter, setRevenueFilter] = useState<'all' | 'month'>('month');
  // Faturamento, faltas e destaque do mês vêm do mesmo cálculo do relatório financeiro (servidor, fuso do negócio,
  // valores gravados): os números do dashboard e do relatório batem
  const { token } = useAuth();
  // Recalculados no próximo desenho depois da virada do dia (a agenda redesenha a cada aviso de mudança)
  const hoje = hojeNoNegocio();
  const mes = useMemo(() => periodoRapido('mes', hoje), [hoje]);
  const ano = useMemo(() => periodoRapido('12meses', hoje), [hoje]);
  const { data: relatorioMes } = useRelatorioFinanceiro(token, mes.de, mes.ate);
  const { data: relatorioAno } = useRelatorioFinanceiro(token, ano.de, ano.ate);

  const todayStr = getLocalTodayString();
  const currentBrazilTime = getBrazilCurrentTimeString();

  const isPendingAppointment = (date: string, status: Appointment['status'], time: string) => {
    if (status !== 'scheduled') return false;
    if (date > todayStr) return true;
    if (date < todayStr) return false;
    return time >= currentBrazilTime;
  };

  const upcomingClients = appointments
    .filter(a => a.date === todayStr && isPendingAppointment(a.date, a.status, a.time))
    .sort((a, b) => a.time.localeCompare(b.time));

  const pendingAppointmentsCount = appointments.filter(a => isPendingAppointment(a.date, a.status, a.time)).length;

  const maxServices = Math.max(...employees.map(e => e.completedServices), 1);

  const topEmployee = useMemo(() => {
    const melhor = [...(relatorioMes?.profissionais ?? [])].sort((a, b) => b.concluidos - a.concluidos)[0];
    const emp = melhor && melhor.concluidos > 0 ? employees.find((e) => e.id === melhor.colaboradorId) : undefined;
    return emp && melhor ? { ...emp, monthlyCount: melhor.concluidos } : null;
  }, [relatorioMes, employees]);
  const monthlyNoShows = relatorioMes?.totais.faltas ?? 0;
  const monthlySemBaixa = relatorioMes?.totais.semBaixa ?? 0;
  const totalRevenue = (revenueFilter === 'month' ? relatorioMes : relatorioAno)?.totais.faturamento ?? 0;

  const { last7DaysData } = useMemo(() => {
    // Dias no fuso do negócio (meio-dia UTC evita trocar o dia), com o valor gravado de cada atendimento
    const hoje = Date.parse(`${hojeNoNegocio()}T12:00:00Z`);
    const chartDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje - i * 86_400_000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayRevenue = appointments.filter(a => a.date === dateStr && a.status === 'completed').reduce((acc, app) => acc + valorDoAtendimento(app, services), 0);
      chartDays.push({ dateStr, label: d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''), revenue: dayRevenue });
    }
    const maxRev = Math.max(...chartDays.map(d => d.revenue), 1);

    return { last7DaysData: { days: chartDays, maxRev } };
  }, [appointments, services]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Total de Atendimentos</p>
          <p className="text-4xl font-headline text-primary">{appointments.filter(a => a.status === 'completed').length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm flex flex-col justify-center overflow-hidden">
          <div className="flex justify-between items-center mb-2 gap-2">
            <p className="text-[10px] font-bold text-outline uppercase tracking-widest">Faturamento</p>
            <select 
              value={revenueFilter}
              onChange={(e) => setRevenueFilter(e.target.value as 'all' | 'month')}
              className="bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[9px] uppercase tracking-widest font-bold rounded px-1.5 py-0.5 border-none outline-none cursor-pointer shrink-0"
            >
              <option value="month">Este mês</option>
              <option value="all">Últimos 12 meses</option>
            </select>
          </div>
          <div className="flex items-center gap-2 mt-1 w-full">
            <p className="text-3xl font-headline text-primary font-bold truncate flex-1" title={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRevenue)}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRevenue)}
          </p>
          <span className="material-symbols-outlined text-primary text-2xl shrink-0 opacity-80 hidden sm:block">payments</span>
        </div>
      </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Agendamentos Pendentes</p>
          <p className="text-4xl font-headline text-primary">{pendingAppointmentsCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Média da Equipe</p>
          <div className="flex items-center gap-2">
            <p className="text-4xl font-headline text-primary">
              {employees.length > 0 ? (employees.reduce((acc, emp) => acc + emp.rating, 0) / employees.length).toFixed(1) : '0.0'}
            </p>
            <span className="material-symbols-outlined text-primary star-active text-2xl">star</span>
          </div>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Destaque do Mês</p>
          {topEmployee ? (
            <div className="flex items-center gap-3 mt-1">
              <img src={topEmployee.avatar} alt={topEmployee.name} className="w-10 h-10 rounded-full object-cover border border-primary/20" />
              <div>
              <p className="text-sm font-bold text-primary leading-tight">{topEmployee.name?.split(' ')[0] || 'Desconhecido'}</p>
                <p className="text-[10px] text-on-surface-variant font-medium">{topEmployee.monthlyCount} concluídos</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant italic mt-1">Sem dados no mês</p>
          )}
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/10 shadow-sm flex flex-col justify-center">
          <p className="text-[10px] font-bold text-outline uppercase tracking-widest mb-2">Faltas no Mês</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-4xl font-headline text-error">{monthlyNoShows}</p>
            <span className="material-symbols-outlined text-error text-2xl">event_busy</span>
          </div>
          {/* Pendência da recepção, separada da falta confirmada: ainda dá para concluir ou marcar falta */}
          {monthlySemBaixa > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium mt-1">
              + {monthlySemBaixa} sem baixa (conclua ou marque falta na agenda)
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
         <div className="lg:col-span-2 flex flex-col gap-8">
           {/* Gráfico de Faturamento Widget */}
           <div className="bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant/10 shadow-sm">
              <div className="flex justify-between items-end mb-6 border-b border-outline-variant/20 pb-4">
                <h3 className="text-lg font-headline text-primary">Faturamento Diário</h3>
                <span className="text-[10px] font-bold text-outline uppercase tracking-widest">Últimos 7 dias</span>
              </div>
              <div className="flex items-end justify-between h-48 gap-2">
                {last7DaysData.days.map((day) => (
                  <div key={day.dateStr} className="flex flex-col items-center flex-1 group">
                    <div className="w-full flex justify-center items-end h-36 bg-surface-container-low/50 rounded-t-lg relative">
                      <div 
                        className="w-full bg-primary/80 hover:bg-primary transition-all rounded-t-lg relative"
                        style={{ height: `${(day.revenue / last7DaysData.maxRev) * 100}%` }}
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-surface-container-highest text-on-surface text-[10px] font-bold py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap shadow-md">
                          {day.revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] text-on-surface-variant uppercase mt-2 font-medium">{day.label}</span>
                  </div>
                ))}
              </div>
           </div>

           {/* Produtividade Widget */}
           <div className="bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant/10 shadow-sm h-fit">
              <h3 className="text-lg font-headline text-primary mb-8 border-b border-outline-variant/20 pb-4">Produtividade da Equipe</h3>
            <div className="space-y-8">
              {employees.map(emp => (
                <div key={emp.id} className="flex flex-col xl:flex-row xl:items-center gap-4">
                  <div className="flex items-center gap-4 w-full xl:w-1/2">
                    <img src={emp.avatar} alt={emp.name} className="w-10 h-10 rounded-full object-cover border border-outline-variant/30" />
                    <div>
                      <p className="text-sm font-bold text-on-surface">{emp.name}</p>
                    </div>
                  </div>
                  <div className="flex-grow w-full">
                    <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                      <span>{emp.completedServices} serviços</span>
                    </div>
                    <div className="h-2 w-full bg-surface-container-high rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all duration-1000" style={{ width: `${(emp.completedServices / maxServices) * 100}%` }}></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
           </div>
         </div>

         {/* Próximos Clientes Widget */}
         <div className="bg-surface-container-lowest p-8 rounded-3xl border border-outline-variant/10 shadow-sm h-fit">
            <div className="flex justify-between items-end mb-6 border-b border-outline-variant/20 pb-4">
              <h3 className="text-lg font-headline text-primary">Próximos Clientes</h3>
              <span className="text-[10px] font-bold text-primary bg-primary-container px-2 py-1 rounded-md uppercase tracking-widest">Hoje</span>
            </div>
            <div className="space-y-4">
              {upcomingClients.length === 0 ? (
                <p className="text-sm text-on-surface-variant text-center py-6">Nenhum cliente agendado para hoje.</p>
              ) : upcomingClients.map(app => (
                <div key={app.id} className="flex justify-between items-center p-4 bg-surface-container-low rounded-2xl border border-outline-variant/10">
                  <div>
                    <h4 className="font-bold text-on-surface">{app.clientName}</h4>
                    <p className="text-xs text-on-surface-variant mt-1">{app.services.join(', ')}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-lg font-headline text-primary font-bold">{app.time}</span>
                    <span className="text-[10px] text-on-surface-variant uppercase tracking-widest">{employees.find(e => e.id === app.assignedEmployeeId)?.name?.split(' ')[0] || 'Não atribuído'}</span>
                  </div>
                </div>
              ))}
            </div>
         </div>
      </div>
    </motion.div>
  );
}