import React, { useMemo } from 'react';
import type { Appointment, Employee } from '../../../types';

export type VisaoAgenda = 'dia' | 'semana' | 'mes';

interface AgendaVisaoPeriodoProps {
  visao: Exclude<VisaoAgenda, 'dia'>;
  dataBase: string;
  todayStr: string;
  // Já filtrados por busca, profissional e recurso
  appointments: Appointment[];
  employees: Employee[];
  onMudarDataBase: (data: string) => void;
  onAbrirDia: (data: string) => void;
  onAbrirAtendimento: (appointment: Appointment) => void;
}

const DIAS_SEMANA = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// Datas AAAA-MM-DD em UTC ao meio-dia: somar dias nunca cai no dia errado por causa do fuso
const somarDias = (data: string, dias: number) =>
  new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const diaDaSemanaSegunda = (data: string) => (new Date(`${data}T12:00:00Z`).getUTCDay() + 6) % 7;
const inicioDaSemana = (data: string) => somarDias(data, -diaDaSemanaSegunda(data));

// Mesma leitura de cores da grade do dia
const corDoAtendimento = (app: Appointment) => {
  if (app.status === 'completed') return 'bg-outline';
  if (app.status === 'no_show') return 'bg-error';
  if (app.aguardandoCheckin) return 'bg-violet-500';
  return 'bg-amber-400';
};
// A cor não basta sozinha (daltonismo, leitor de tela): o estado também vai por escrito
const estadoDoAtendimento = (app: Appointment) => {
  if (app.status === 'completed') return 'concluído';
  if (app.status === 'no_show') return 'falta';
  if (app.aguardandoCheckin) return 'totem, aguardando chegada';
  return 'agendado';
};

export function AgendaVisaoPeriodo({ visao, dataBase, todayStr, appointments, employees, onMudarDataBase, onAbrirDia, onAbrirAtendimento }: AgendaVisaoPeriodoProps) {
  const nomes = useMemo(() => new Map(employees.map((e) => [e.id, e.name.split(' ')[0] || e.name])), [employees]);

  // Dias exibidos: a semana (segunda a domingo) ou o mês inteiro completado até fechar as semanas
  const dias = useMemo(() => {
    if (visao === 'semana') {
      const inicio = inicioDaSemana(dataBase);
      return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
    }
    const primeiro = `${dataBase.slice(0, 7)}-01`;
    const [ano, mes] = dataBase.split('-').map(Number);
    const ultimo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    const inicio = inicioDaSemana(primeiro);
    const fim = somarDias(ultimo, 6 - diaDaSemanaSegunda(ultimo));
    const total = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;
    return Array.from({ length: total }, (_, i) => somarDias(inicio, i));
  }, [visao, dataBase]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, Appointment[]>();
    const primeiro = dias[0];
    const ultimo = dias[dias.length - 1];
    for (const app of appointments) {
      if (app.date < primeiro || app.date > ultimo || app.status === 'cancelled') continue;
      const lista = mapa.get(app.date);
      if (lista) lista.push(app);
      else mapa.set(app.date, [app]);
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.time.localeCompare(b.time));
    return mapa;
  }, [appointments, dias]);

  const [ano, mes] = dataBase.split('-').map(Number);
  const titulo = visao === 'semana'
    ? `Semana de ${dias[0].split('-').reverse().join('/')} a ${dias[6].split('-').reverse().join('/')}`
    : `${MESES[mes - 1]} de ${ano}`;
  const navegar = (direcao: 1 | -1) => {
    if (visao === 'semana') return onMudarDataBase(somarDias(dataBase, 7 * direcao));
    onMudarDataBase(new Date(Date.UTC(ano, mes - 1 + direcao, 1)).toISOString().slice(0, 10));
  };
  const maxPorCelula = visao === 'semana' ? 50 : 3;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={() => navegar(-1)} aria-label={visao === 'semana' ? 'Semana anterior' : 'Mês anterior'} title={visao === 'semana' ? 'Semana anterior' : 'Mês anterior'} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant">
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold uppercase tracking-widest text-primary">{titulo}</h4>
          <button type="button" onClick={() => onMudarDataBase(todayStr)} className="text-[11px] font-bold text-primary border border-primary/30 rounded-full px-2.5 py-0.5 hover:bg-primary/10">
            Hoje
          </button>
        </div>
        <button type="button" onClick={() => navegar(1)} aria-label={visao === 'semana' ? 'Próxima semana' : 'Próximo mês'} title={visao === 'semana' ? 'Próxima semana' : 'Próximo mês'} className="p-2 rounded-full hover:bg-surface-container text-on-surface-variant">
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[700px]">
          {DIAS_SEMANA.map((d) => (
            <span key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-outline py-1">{d}</span>
          ))}
          {dias.map((dia) => {
            const lista = porDia.get(dia) ?? [];
            const foraDoMes = visao === 'mes' && dia.slice(0, 7) !== dataBase.slice(0, 7);
            return (
              <div
                key={dia}
                className={`rounded-xl border p-1.5 flex flex-col gap-1 ${visao === 'semana' ? 'min-h-[260px]' : 'min-h-[110px]'} ${dia === todayStr ? 'border-primary' : 'border-outline-variant/20'} ${foraDoMes ? 'bg-surface-container-low/40' : 'bg-surface-container-lowest'}`}
              >
                <button type="button" onClick={() => onAbrirDia(dia)} className="flex items-center justify-between text-left hover:text-primary" title="Abrir este dia na grade">
                  {/* Fora do mês só o número esmaece: os atendimentos continuam legíveis */}
                  <span className={`text-xs font-bold ${dia === todayStr ? 'text-primary' : foraDoMes ? 'text-outline' : 'text-on-surface'}`}>{Number(dia.slice(8))}</span>
                  <span className="text-[10px] font-bold text-on-surface-variant">
                    {/* 'Livre' sugeriria vaga mesmo em domingo, feriado ou dia de folga de todos */}
                    {lista.length === 0 ? 'Sem atendimentos' : `${lista.length} ${lista.length === 1 ? 'atendimento' : 'atendimentos'}`}
                  </span>
                </button>
                {lista.slice(0, maxPorCelula).map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => onAbrirAtendimento(app)}
                    className={`flex gap-1 rounded-lg bg-surface-container-low px-1.5 py-1 text-left hover:bg-primary/10 ${visao === 'semana' ? 'items-start' : 'items-center'}`}
                    title={`${app.time} · ${app.clientName} · ${app.services.join(', ')} · ${nomes.get(app.assignedEmployeeId) ?? ''} · ${estadoDoAtendimento(app)}`}
                    aria-label={`${app.time}, ${app.clientName}, com ${nomes.get(app.assignedEmployeeId) ?? 'profissional'}, ${estadoDoAtendimento(app)}`}
                  >
                    <span className={`w-2 h-2 rounded-full ring-1 ring-on-surface/25 shrink-0 ${visao === 'semana' ? 'mt-1' : ''} ${corDoAtendimento(app)}`} />
                    {visao === 'semana' ? (
                      // Semana: espaço para ler cliente e profissional sem abrir o atendimento
                      <span className="min-w-0">
                        <span className="block text-[10px] font-bold tabular-nums text-on-surface-variant">{app.time} · {nomes.get(app.assignedEmployeeId) ?? ''}</span>
                        <span className={`block text-[11px] leading-tight line-clamp-2 break-words ${app.status === 'completed' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>{app.clientName}</span>
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] font-bold tabular-nums text-on-surface-variant">{app.time}</span>
                        <span className={`text-[10px] truncate ${app.status === 'completed' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>{app.clientName}</span>
                      </>
                    )}
                  </button>
                ))}
                {lista.length > maxPorCelula && (
                  <button type="button" onClick={() => onAbrirDia(dia)} className="text-[10px] font-bold text-primary text-left px-1.5">
                    +{lista.length - maxPorCelula} mais
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
