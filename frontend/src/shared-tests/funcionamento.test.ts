import { describe, expect, it } from 'vitest';
import { abreNaData, bloqueioDiaInteiro, funcionamentoNaData, FOLGA_FIM, FOLGA_INICIO, lerFuncionamento, validarFuncionamento, validarHorarioAgendamento, type Funcionamento } from '@shared/agenda';

// 2027-03-01 é segunda; 2027-03-07, domingo
const casa: Funcionamento = { abertura: '08:00', fechamento: '18:00', limite: '16:00', dias: [1, 2, 3, 4, 5, 6], especiais: [] };
const v = (data: string, horario: string, duracao = 60, f: Funcionamento = casa) => validarHorarioAgendamento(data, horario, duracao, { funcionamento: f });

describe('horário de funcionamento', () => {
  it('sem config vale o padrão de antes (09:00 às 21:00, todos os dias)', () => {
    expect(lerFuncionamento(null)).toEqual({ abertura: '09:00', fechamento: '21:00', limite: null, dias: [0, 1, 2, 3, 4, 5, 6], especiais: [] });
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

describe('dias especiais', () => {
  // 2027-03-03 é quarta; 2027-03-04, quinta; 2027-03-07, domingo (fechado na semana da casa)
  const comEspeciais: Funcionamento = {
    ...casa,
    especiais: [
      { data: '2027-03-03', fechado: true, abertura: null, fechamento: null, motivo: 'Inventário' },
      { data: '2027-03-04', fechado: false, abertura: '10:00', fechamento: '14:00', motivo: null },
      { data: '2027-03-07', fechado: false, abertura: '09:00', fechamento: '12:00', motivo: null },
    ],
  };
  it('data fechada recusa com a data e o motivo; os outros dias seguem o horário da semana', () => {
    expect(v('2027-03-03', '10:00', 60, comEspeciais)).toBe('A casa estará fechada em 03/03/2027 (Inventário).');
    expect(abreNaData(comEspeciais, '2027-03-03')).toBe(false);
    expect(v('2027-03-02', '10:00', 60, comEspeciais)).toBeNull();
  });
  it('horário próprio vale só naquela data, sem o último horário da semana', () => {
    expect(v('2027-03-04', '09:00', 60, comEspeciais)).toMatch(/entre 10:00 e 14:00/);
    expect(v('2027-03-04', '13:00', 60, comEspeciais)).toBeNull();
    expect(v('2027-03-04', '13:30', 60, comEspeciais)).toMatch(/depois do fechamento \(14:00\)/);
    expect(funcionamentoNaData(comEspeciais, '2027-03-04')).toMatchObject({ abertura: '10:00', fechamento: '14:00', limite: null });
  });
  it('abre num dia da semana fechado', () => {
    expect(v('2027-03-07', '09:00', 60, comEspeciais)).toBeNull();
    expect(v('2027-03-14', '09:00', 60, comEspeciais)).toMatch(/não abre aos domingos/);
  });
  it('bloqueio de dia inteiro usa o horário do dia especial', () => {
    // Quinta especial das 10h às 14h: bloquear 10h–14h é o dia todo; na semana (08h–18h) não seria
    expect(bloqueioDiaInteiro({ data: '2027-03-04', horaInicio: '10:00', horaFim: '14:00' }, comEspeciais)).toBe(true);
    expect(bloqueioDiaInteiro({ data: '2027-03-02', horaInicio: '10:00', horaFim: '14:00' }, comEspeciais)).toBe(false);
  });
  it('validação: horário invertido, data repetida e lixo gravado no banco', () => {
    expect(validarFuncionamento({ ...casa, especiais: [{ data: '2027-03-04', fechado: false, abertura: '14:00', fechamento: '10:00', motivo: null }] })).toMatch(/depois da abertura/);
    const dia = comEspeciais.especiais[0];
    expect(validarFuncionamento({ ...casa, especiais: [dia, dia] })).toMatch(/mesma data/);
    expect(validarFuncionamento(comEspeciais)).toBeNull();
    const lido = lerFuncionamento({ diasEspeciais: [{ data: '2027-02-30', fechado: true }, 'lixo', { data: '2027-03-05', fechado: true, motivo: '  Obras ' }] });
    expect(lido.especiais).toEqual([{ data: '2027-03-05', fechado: true, abertura: null, fechamento: null, motivo: 'Obras' }]);
  });
});
