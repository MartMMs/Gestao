import { describe, expect, it } from 'vitest';
import { bloqueioDiaInteiro, FOLGA_FIM, FOLGA_INICIO, lerFuncionamento, validarFuncionamento, validarHorarioAgendamento, type Funcionamento } from '@shared/agenda';

// 2027-03-01 é segunda; 2027-03-07, domingo
const casa: Funcionamento = { abertura: '08:00', fechamento: '18:00', limite: '16:00', dias: [1, 2, 3, 4, 5, 6] };
const v = (data: string, horario: string, duracao = 60, f: Funcionamento = casa) => validarHorarioAgendamento(data, horario, duracao, { funcionamento: f });

describe('horário de funcionamento', () => {
  it('sem config vale o padrão de antes (09:00 às 21:00, todos os dias)', () => {
    expect(lerFuncionamento(null)).toEqual({ abertura: '09:00', fechamento: '21:00', limite: null, dias: [0, 1, 2, 3, 4, 5, 6] });
    expect(validarHorarioAgendamento('2027-03-07', '09:00', 60)).toBeNull();
    expect(validarHorarioAgendamento('2027-03-01', '08:45', 60)).toMatch(/entre 09:00 e 21:00/);
  });

  it('abertura, último horário de início e fechamento', () => {
    expect(v('2027-03-01', '08:00')).toBeNull();
    expect(v('2027-03-01', '07:45')).toMatch(/entre 08:00 e 16:00/);
    expect(v('2027-03-01', '16:00')).toBeNull(); // o limite é o último início aceito
    expect(v('2027-03-01', '16:15')).toMatch(/entre 08:00 e 16:00/);
    expect(v('2027-03-01', '16:00', 150)).toMatch(/depois do fechamento \(18:00\)/);
    expect(v('2027-03-01', '17:00', 60, { ...casa, limite: null })).toBeNull(); // sem limite: até o fechamento
  });

  it('dia fechado recusa com o nome do dia', () => {
    expect(v('2027-03-07', '10:00')).toBe('A casa não abre aos domingos.');
    expect(v('2027-03-02', '10:00', 60, { ...casa, dias: [1] })).toBe('A casa não abre às terças.');
  });

  it('valida o que vai ser gravado', () => {
    expect(validarFuncionamento(casa)).toBeNull();
    expect(validarFuncionamento({ ...casa, fechamento: '08:00' })).toMatch(/depois da abertura/);
    expect(validarFuncionamento({ ...casa, limite: '18:00' })).toMatch(/antes do fechamento/);
    expect(validarFuncionamento({ ...casa, dias: [] })).toMatch(/pelo menos um dia/);
    expect(validarFuncionamento({ ...casa, dias: [1, 1] })).toMatch(/inválidos/);
    expect(validarFuncionamento({ ...casa, dias: [7] })).toMatch(/inválidos/);
    expect(validarFuncionamento({ ...casa, abertura: '' })).toBe('Preencha a abertura e o fechamento.');
    // Horários da agenda andam de 15 em 15 min: abertura 09:10 ou limite 19:50 nunca seriam aceitos
    expect(validarFuncionamento({ ...casa, abertura: '08:10' })).toMatch(/15 em 15/);
    expect(validarFuncionamento({ ...casa, limite: '15:50' })).toMatch(/15 em 15/);
    expect(validarFuncionamento({ ...casa, abertura: '08:15', limite: '15:45' })).toBeNull();
  });

  it('dias gravados vazios ou com lixo valem o padrão (não fecham a casa inteira)', () => {
    expect(lerFuncionamento({ diasFuncionamento: [] }).dias).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(lerFuncionamento({ diasFuncionamento: [1, 9] }).dias).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(lerFuncionamento({ diasFuncionamento: [1, 2] }).dias).toEqual([1, 2]);
  });

  it('folga do dia inteiro segue o horário da casa', () => {
    expect(bloqueioDiaInteiro({ horaInicio: '08:00', horaFim: '18:00' }, casa)).toBe(true);
    expect(bloqueioDiaInteiro({ horaInicio: '09:00', horaFim: '18:00' }, casa)).toBe(false);
    // Folga nova (00:00 às 23:59) continua dia inteiro com qualquer horário da casa
    for (const f of [casa, { ...casa, abertura: '06:00', fechamento: '23:00', limite: null }]) {
      expect(bloqueioDiaInteiro({ horaInicio: FOLGA_INICIO, horaFim: FOLGA_FIM }, f)).toBe(true);
    }
  });
});
