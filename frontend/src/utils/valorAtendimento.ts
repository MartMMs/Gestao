import type { Appointment, Service } from '../types';

// Valor de um atendimento: o gravado no dia (agendamentos novos); para registros antigos sem valor, o preço atual
export const valorDoAtendimento = (app: Appointment, services: Service[]) => (
  typeof app.valorTotal === 'number'
    ? app.valorTotal
    : app.services.reduce((soma, nome) => soma + (Number(services.find((s) => s.nome === nome)?.preco) || 0), 0)
);
