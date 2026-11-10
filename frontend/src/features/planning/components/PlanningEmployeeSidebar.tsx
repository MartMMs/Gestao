import React, { useMemo, useState } from 'react';
import { Employee } from '../../../types';
import { DiaEscala } from '../../../utils/escalaCalculator';
import { analisarMes, formatarHoras, iniciais } from '../utils/turnos';

interface PlanningEmployeeSidebarProps {
  employees: Employee[];
  selectedEmployeeId?: string;
  onSelectEmployee: (employeeId: string) => void;
  /** Escala de cada um com os meses vizinhos (a mesma que o calendário analisa) */
  escalas: Map<string, DiaEscala[]>;
  prefixoMes: string; // "AAAA-MM-"
}

// Mesma análise do calendário (analisarMes): os dois nunca discordam sobre a mesma pessoa
const avaliar = (employee: Employee, dias: DiaEscala[], prefixoMes: string) => {
  const analise = analisarMes(dias, prefixoMes, employee.tipoEscala || '6x1');
  return {
    employee,
    conforme: analise.conforme,
    motivo: analise.conforme ? 'Escala dentro das regras da CLT' : analise.alertas.join(' '),
    horasMes: analise.horasMes,
    diasSemTurno: analise.diasSemTurno,
  };
};

export function PlanningEmployeeSidebar({ employees, selectedEmployeeId, onSelectEmployee, escalas, prefixoMes }: PlanningEmployeeSidebarProps) {
  const [soAlertas, setSoAlertas] = useState(false);

  const resumos = useMemo(
    () => employees.map((emp) => avaliar(emp, escalas.get(emp.id) || [], prefixoMes)),
    [employees, escalas, prefixoMes],
  );
  const comAlerta = resumos.filter((r) => !r.conforme).length;
  const visiveis = soAlertas ? resumos.filter((r) => !r.conforme) : resumos;

  return (
    <aside aria-label="Colaboradores da escala" className="w-full xl:w-80 shrink-0 bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-sm flex flex-col overflow-hidden">
      <div className="p-4 border-b border-outline-variant/15 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface leading-tight">Colaboradores ({resumos.length})</h3>
          <p className="text-[11px] text-on-surface-variant">
            {resumos.length - comAlerta} dentro da CLT • {comAlerta} com alerta
          </p>
        </div>

        <div role="group" aria-label="Filtrar colaboradores" className="grid grid-cols-2 gap-1 bg-surface-container-low p-1 rounded-xl border border-outline-variant/20">
          {[
            { valor: false, rotulo: `Todos (${resumos.length})` },
            { valor: true, rotulo: `Com alerta (${comAlerta})` },
          ].map((aba) => (
            <button
              key={aba.rotulo}
              type="button"
              aria-pressed={soAlertas === aba.valor}
              onClick={() => setSoAlertas(aba.valor)}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all ${
                soAlertas === aba.valor
                  ? 'bg-surface-container-lowest text-on-surface shadow-xs border border-outline-variant/30'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {aba.rotulo}
            </button>
          ))}
        </div>
      </div>

      {/* Lista com altura limitada: no celular não empurra o calendário para longe */}
      <div className="divide-y divide-outline-variant/10 max-h-64 xl:max-h-[560px] overflow-y-auto custom-scrollbar">
        {visiveis.length === 0 ? (
          <p className="p-8 text-center text-xs font-medium text-on-surface-variant">
            {soAlertas ? 'Nenhum colaborador com alerta no mês.' : 'Nenhum colaborador com esses filtros.'}
          </p>
        ) : (
          visiveis.map(({ employee, conforme, motivo, horasMes, diasSemTurno }) => {
            const selecionado = employee.id === selectedEmployeeId;
            return (
              <button
                key={employee.id}
                type="button"
                aria-current={selecionado ? 'true' : undefined}
                onClick={() => onSelectEmployee(employee.id)}
                className={`w-full p-3.5 text-left transition-colors flex items-start gap-3 border-l-[3px] ${
                  selecionado ? 'bg-primary/10 border-l-primary' : 'hover:bg-surface-container-low/70 border-l-transparent'
                }`}
              >
                <span className="relative shrink-0 mt-0.5">
                  {employee.avatar ? (
                    <img src={employee.avatar} alt="" className="w-9 h-9 rounded-full object-cover border border-outline-variant/30" />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-surface-container text-on-surface text-xs font-semibold flex items-center justify-center border border-outline-variant/30">
                      {iniciais(employee.name)}
                    </span>
                  )}
                  <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-surface-container-lowest ${conforme ? 'bg-green-500' : 'bg-red-500'}`} />
                </span>

                <span className="flex-1 min-w-0">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold truncate ${selecionado ? 'text-primary' : 'text-on-surface'}`}>{employee.name}</span>
                    <span
                      className="text-[11px] font-semibold tabular-nums shrink-0 text-on-surface-variant"
                      title={diasSemTurno > 0 ? `${diasSemTurno} dia(s) de trabalho sem turno definido não entram nas horas` : 'Horas de turno no mês'}
                    >
                      {horasMes > 0 ? formatarHoras(horasMes) : '—'}{diasSemTurno > 0 ? '*' : ''}
                    </span>
                  </span>
                  <span className="block text-[11px] text-on-surface-variant truncate mt-0.5">
                    {employee.cargo || employee.specialty || 'Profissional'} • {employee.tipoEscala || '6x1'}
                  </span>
                  {/* O motivo fica visível (e lido pelo leitor de tela), não só num tooltip */}
                  <span className={`block text-[11px] mt-1 ${conforme ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'} ${selecionado ? '' : 'line-clamp-1'}`}>
                    {conforme ? '✓ ' : ''}{motivo}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
