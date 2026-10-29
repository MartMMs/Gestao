import { describe, expect, it } from 'vitest';
import { gerarEscala6x1, gerarEscala5x2, gerarEscala12x36, gerarEscalaComRegras, calcularHorasEscala } from './escalaCalculator';
import { analisarSetimoDiaConsecutivo, analisarInterjornadaEscala, calcularDiferencaInterjornada, analisarConformidadeCLT } from './cltValidator';
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
describe(`escala (TZ=${process.env.TZ})`, () => {
  it('6x1: domingos reais (calendário) são os dias fds — novembro/2026 começa num domingo', () => {
    const dias = gerarEscala6x1('2026-11-01', 30);
    expect(dias[0].data).toBe('2026-11-01');
    for (const d of dias) if (dow(d.data) === 0) expect([d.data, d.tipo]).toEqual([d.data, 'fds']);
    for (const d of dias) if (d.tipo === 'fds') expect([d.data, dow(d.data)]).toEqual([d.data, 0]);
  });
  it('5x2 iniciando numa segunda: sáb/dom de folga', () => {
    const dias = gerarEscala5x2('2026-11-02', 7);
    expect(dias.map(d => d.tipo)).toEqual(['trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'folga', 'folga']);
  });
  it('12x36: trabalha dia sim, dia não', () => {
    const dias = gerarEscala12x36('2026-11-02', 6, { diurno: { inicio: '07:00', fim: '19:00' }, noturno: { inicio: '19:00', fim: '07:00' } });
    expect(dias.map(d => d.tipo)).toEqual(['trabalho', 'folga', 'trabalho', 'folga', 'trabalho', 'folga']);
  });
  it('6x1 gerado pelo sistema não pode violar DSR (7º dia)', () => {
    for (const mes of ['2026-01-01', '2026-02-01', '2026-03-01', '2026-11-01', '2027-08-01']) {
      const dias = gerarEscalaComRegras({ tipo: '6x1', dataInicio: mes }, 31, { folgasDomingoNoMes: 2 });
      expect([mes, analisarSetimoDiaConsecutivo(dias).violacoes.length]).toEqual([mes, 0]);
    }
  });
  it('feriado em dia de trabalho vira fds', () => {
    const dias = gerarEscalaComRegras({ tipo: '5x2', dataInicio: '2026-11-16' }, 7);
    expect(dias.find(d => d.data === '2026-11-20')?.tipo).toBe('fds');
  });
  it('CLT: interjornada exata e virada de dia', () => {
    expect(calcularDiferencaInterjornada(new Date('2026-01-01T22:00:00'), new Date('2026-01-02T08:59:00')).conforme).toBe(false);
    expect(calcularDiferencaInterjornada(new Date('2026-01-01T22:00:00'), new Date('2026-01-02T09:00:00')).conforme).toBe(true);
    const r = analisarInterjornadaEscala([
      { data: '2026-01-05', tipo: 'trabalho', horaInicio: '14:00', horaFim: '23:00' },
      { data: '2026-01-06', tipo: 'trabalho', horaInicio: '07:00', horaFim: '15:00' },
    ]);
    expect(r.conforme).toBe(false); expect(r.menorInterjornada).toBe(8);
    const noturno = analisarInterjornadaEscala([
      { data: '2026-01-05', tipo: 'trabalho', horaInicio: '19:00', horaFim: '07:00' },
      { data: '2026-01-06', tipo: 'trabalho', horaInicio: '15:00', horaFim: '23:00' },
    ]);
    expect(noturno.menorInterjornada).toBe(8); expect(noturno.conforme).toBe(false);
  });
  it('CLT: 7 dias seguidos violam, buraco no calendário zera sequência; carga > 44h acusa', () => {
    const seq = (n: number, ini = 5) => Array.from({ length: n }, (_, i) => ({ data: `2026-01-${String(ini + i).padStart(2, '0')}`, tipo: 'trabalho' as const, horaInicio: '08:00', horaFim: '17:00' }));
    expect(analisarSetimoDiaConsecutivo(seq(7)).violacoes[0]?.data).toBe('2026-01-11');
    expect(analisarSetimoDiaConsecutivo(seq(6)).conforme).toBe(true);
    expect(analisarSetimoDiaConsecutivo([...seq(3, 1), ...seq(4, 5)]).conforme).toBe(true);
    expect(analisarConformidadeCLT(seq(7)).cargaSemanal.conforme).toBe(false); // 63h
    expect(calcularHorasEscala(seq(2)).horasTrabalhadas).toBe(18);
  });
});
