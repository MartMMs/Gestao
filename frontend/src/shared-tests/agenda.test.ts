import { describe, expect, it } from 'vitest';
import { validarHorarioAgendamento, instanteNoFuso, partesNoFuso, dataValida, horarioValido, duracaoTotal, duracaoServico, intervalosSobrepoem, minutosParaHorario } from '@shared/agenda';
describe('agenda compartilhada', () => {
  it('datas/horários', () => {
    expect(dataValida('2026-02-29')).toBe(false);
    expect(dataValida('2028-02-29')).toBe(true);
    expect(dataValida('2026-13-01')).toBe(false);
    expect(horarioValido('24:00')).toBe(false);
    expect(horarioValido('9:00')).toBe(false);
    expect(minutosParaHorario(615)).toBe('10:15');
  });
  it('janela de funcionamento e grade', () => {
    expect(validarHorarioAgendamento('2027-01-04', '09:00', 60)).toBeNull();
    expect(validarHorarioAgendamento('2027-01-04', '08:45', 60)).toMatch(/só podem começar/);
    expect(validarHorarioAgendamento('2027-01-04', '21:00', 15)).toMatch(/só podem começar/);
    expect(validarHorarioAgendamento('2027-01-04', '20:00', 60)).toBeNull();
    expect(validarHorarioAgendamento('2027-01-04', '20:15', 60)).toMatch(/fechamento/);
    expect(validarHorarioAgendamento('2027-01-04', '10:10', 60)).toMatch(/múltiplos/);
    expect(validarHorarioAgendamento('2027-01-04', '10:15', 60, { intervaloMin: 30 })).toMatch(/30/);
    expect(validarHorarioAgendamento('2027-01-04', '10:00', 0)).toMatch(/Duração/);
    expect(validarHorarioAgendamento('2027-01-04', '10:00', NaN)).toMatch(/Duração/);
  });
  it('passado no fuso de Brasília', () => {
    const agora = new Date('2027-01-04T13:30:00Z'); // 10:30 BRT
    expect(validarHorarioAgendamento('2027-01-04', '10:15', 60, { agora })).toMatch(/já passou/);
    expect(validarHorarioAgendamento('2027-01-04', '10:30', 60, { agora })).toBeNull();
    expect(validarHorarioAgendamento('2027-01-03', '20:00', 60, { agora })).toMatch(/já passou/);
    // 01:00Z do dia 5 ainda é dia 4 em Brasília (22:00)
    expect(partesNoFuso(new Date('2027-01-05T01:00:00Z')).data).toBe('2027-01-04');
  });
  it('instanteNoFuso', () => {
    expect(instanteNoFuso('2027-01-04', '10:00').toISOString()).toBe('2027-01-04T13:00:00.000Z');
    expect(instanteNoFuso('2027-01-04', '23:30').toISOString()).toBe('2027-01-05T02:30:00.000Z');
  });
  it('duração e sobreposição', () => {
    expect(duracaoTotal()).toBe(60);
    expect(duracaoServico({ duracao: 30, tempoHigienizacaoMin: 15 })).toBe(45);
    expect(duracaoTotal([{ duracao: 30 }, { duracao: null }])).toBe(90);
    expect(intervalosSobrepoem(600, 660, 660, 720)).toBe(false);
    expect(intervalosSobrepoem(600, 661, 660, 720)).toBe(true);
  });
});
