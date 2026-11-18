import { describe, it, expect } from 'vitest';
import type { Appointment } from '../../../types';
import { atendimentosSemBaixa } from './ListaSemBaixa';

const ag = (id: string, date: string, time: string, status: Appointment['status'] = 'scheduled'): Appointment => ({
  id, clientName: id, contact: '', services: [], date, time, guests: 1, specialNeeds: [], assignedEmployeeId: 'p1', status,
});
// 10/12/2026 14:00 em Brasília (17:00 UTC). Sem serviço, a duração padrão é 60 min
const AGORA = new Date('2026-12-10T17:00:00Z');

describe('lista "Sem baixa"', () => {
  it('só os agendados que já terminaram, do mais antigo para o mais recente', () => {
    const lista = atendimentosSemBaixa([
      ag('ontem-tarde', '2026-12-09', '15:00'),
      ag('hoje-cedo', '2026-12-10', '09:00'),
      ag('ontem-cedo', '2026-12-09', '08:00'),
      ag('em-andamento', '2026-12-10', '13:30'), // termina 14:30
      ag('concluido', '2026-12-09', '10:00', 'completed'),
      ag('falta', '2026-12-09', '11:00', 'no_show'),
      ag('amanha', '2026-12-11', '09:00'),
    ], [], AGORA);
    expect(lista.map((a) => a.id)).toEqual(['ontem-cedo', 'ontem-tarde', 'hoje-cedo']);
  });
});
