import React from 'react';
import { Employee, Service } from '../types';
import { SCHEDULE_CONFIG } from '../config/scheduleConfig';

interface AppointmentScheduleFieldsProps {
  date: string;
  time: string;
  employeeId: string;
  selectedServices: string[];
  details: string;
  employees: Employee[];
  services: Service[];
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onEmployeeChange: (value: string) => void;
  onToggleService: (serviceName: string) => void;
  onDetailsChange: (value: string) => void;
  disabled?: boolean;
  showServiceSearch?: boolean;
  serviceSearchTerm?: string;
  onServiceSearchTermChange?: (value: string) => void;
  detailsLabel?: string;
  detailsPlaceholder?: string;
  detailsAction?: React.ReactNode;
  employeeHelperText?: string;
}

const START_TIME = `${String(SCHEDULE_CONFIG.START_HOUR).padStart(2, '0')}:00`;
const END_TIME = `${String(SCHEDULE_CONFIG.END_HOUR).padStart(2, '0')}:00`;

export function AppointmentScheduleFields({
  date,
  time,
  employeeId,
  selectedServices,
  details,
  employees,
  services,
  onDateChange,
  onTimeChange,
  onEmployeeChange,
  onToggleService,
  onDetailsChange,
  disabled = false,
  showServiceSearch = false,
  serviceSearchTerm = '',
  onServiceSearchTermChange,
  detailsLabel = 'Detalhes',
  detailsPlaceholder = '',
  detailsAction,
  employeeHelperText,
}: AppointmentScheduleFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Data</label>
          <input
            required
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            disabled={disabled}
            className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Horário</label>
          <input
            required
            type="time"
            min={START_TIME}
            max={END_TIME}
            value={time}
            onChange={(e) => onTimeChange(e.target.value)}
            disabled={disabled}
            className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
        </div>
        <div className="md:col-span-1">
          <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Profissional</label>
          <select
            required
            value={employeeId}
            onChange={(e) => onEmployeeChange(e.target.value)}
            disabled={disabled}
            className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <option value="" disabled>Selecione...</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>{employee.name}</option>
            ))}
          </select>
          {employeeHelperText && (
            <p className="mt-2 text-[10px] text-on-surface-variant">{employeeHelperText}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Serviços</label>
        {showServiceSearch && (
          <input
            type="text"
            value={serviceSearchTerm}
            onChange={(e) => onServiceSearchTermChange?.(e.target.value)}
            disabled={disabled}
            className={`w-full mb-2 bg-surface-container-low border border-outline-variant/20 rounded-xl p-2 focus:ring-1 focus:ring-primary text-sm ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            placeholder="Pesquisar serviço..."
          />
        )}

        <div className="grid grid-cols-1 gap-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
          {/* Serviço fora de linha só aparece se o atendimento já o tem */}
          {services.filter((service) => service.ativo !== false || selectedServices.includes(service.nome)).map((service) => {
            const isSelected = selectedServices.includes(service.nome);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => {
                  if (!disabled) onToggleService(service.nome);
                }}
                disabled={disabled}
                className={`text-left p-2 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-primary/10 border-primary shadow-sm' : 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary/50'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold leading-tight ${isSelected ? 'text-primary' : 'text-on-surface'}`}>{service.nome}</span>
                  <span className="text-[9px] text-on-surface-variant uppercase tracking-widest">{isSelected ? 'Selecionado' : 'Toque para incluir'}</span>
                </div>
                {service.descricao && <p className="text-[10px] text-on-surface-variant mt-1 line-clamp-1">{service.descricao}</p>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-outline-variant/20 pt-4 mt-4">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase">{detailsLabel}</label>
          {detailsAction}
        </div>
        <textarea
          rows={3}
          value={details}
          onChange={(e) => onDetailsChange(e.target.value)}
          disabled={disabled}
          className={`w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 focus:ring-1 focus:ring-primary text-sm resize-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          placeholder={detailsPlaceholder}
        />
      </div>
    </>
  );
}