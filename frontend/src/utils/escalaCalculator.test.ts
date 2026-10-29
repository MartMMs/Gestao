import { describe, expect, it } from 'vitest';
import {
  aplicarFeriadosNaEscala,
  aplicarFolgasDomingoNoMes,
  calcularHorasEscala,
  gerarEscalaComRegras,
  gerarEscala12x36,
  gerarEscala5x2,
  gerarEscala6x1,
  proximaFolga,
} from './escalaCalculator';

const BR_NOON = (d: string) => `${d}T12:00:00-03:00`;

describe('gerarEscala5x2', () => {
  it('mantem ciclo de 7 dias com 5 trabalho e 2 folgas', () => {
    const dias = gerarEscala5x2(BR_NOON('2026-06-01'), 14);
    expect(dias).toHaveLength(14);
    const tipos = dias.map((d) => d.tipo);
    expect(tipos.slice(0, 7)).toEqual([
      'trabalho',
      'trabalho',
      'trabalho',
      'trabalho',
      'trabalho',
      'folga',
      'folga',
    ]);
  });
});

describe('gerarEscala6x1', () => {
  it('marca domingo como fds quando cai no calendario', () => {
    const dias = gerarEscala6x1(BR_NOON('2026-06-07'), 3);
    const domingo = dias.find((d) => d.data === '2026-06-07');
    expect(domingo?.tipo).toBe('fds');
  });
});

describe('gerarEscala12x36', () => {
  it('12h de trabalho e 36h de descanso: dia sim, dia não, sempre no mesmo turno', () => {
    const dias = gerarEscala12x36(BR_NOON('2026-06-01'), 6, {
      diurno: { inicio: '07:00', fim: '19:00' },
      noturno: { inicio: '19:00', fim: '07:00' },
    });
    const tipos = dias.map((d) => d.tipo);
    for (let i = 1; i < tipos.length; i++) expect(tipos[i]).not.toBe(tipos[i - 1]);
    expect(new Set(dias.filter((d) => d.tipo === 'trabalho').map((d) => d.turno))).toEqual(new Set(['Diurno']));
  });

  it('gerada mês a mês, não junta dois plantões na virada (31/01 e 01/02)', () => {
    const turnos = { diurno: { inicio: '07:00', fim: '19:00' }, noturno: { inicio: '19:00', fim: '07:00' } };
    const janeiro = gerarEscala12x36('2026-01-01', 31, turnos);
    const fevereiro = gerarEscala12x36('2026-02-01', 28, turnos);
    const emSequencia = [...janeiro, ...fevereiro].map((d) => d.tipo);
    for (let i = 1; i < emSequencia.length; i++) expect(emSequencia[i]).not.toBe(emSequencia[i - 1]);
  });
});

describe('aplicarFeriadosNaEscala', () => {
  it('converte trabalho em feriado para dia indisponivel (fds) com descricao de feriado', () => {
    const out = aplicarFeriadosNaEscala([
      {
        data: '2026-05-01',
        tipo: 'trabalho',
        turno: '08:00-18:00',
        horaInicio: '08:00',
        horaFim: '18:00',
      },
    ]);

    expect(out[0]?.tipo).toBe('fds');
    expect(out[0]?.turno).toBeUndefined();
    expect(out[0]?.feriadoNome).toBe('Dia do Trabalho');
    expect(out[0]?.descricao).toContain('Feriado');
  });
});

describe('gerarEscalaComRegras', () => {
  it('aplica feriado e folga dominical no mesmo pipeline', () => {
    const out = gerarEscalaComRegras(
      {
        tipo: '6x1',
        dataInicio: BR_NOON('2026-04-20'),
      },
      8,
      { folgasDomingoNoMes: 1 },
    );

    const tiradentes = out.find((dia) => dia.data === '2026-04-21');
    const domingo = out.find((dia) => dia.data === '2026-04-26');

    expect(tiradentes?.feriadoNome).toBe('Tiradentes');
    expect(tiradentes?.tipo).toBe('fds');
    expect(domingo?.folgaDominicalConfigurada).toBe(true);
  });
});

describe('aplicarFolgasDomingoNoMes (CLT / folga dominical)', () => {
  it('nao altera lista quando meta <= 0', () => {
    const dias = gerarEscala5x2(BR_NOON('2026-06-01'), 7);
    const out = aplicarFolgasDomingoNoMes(dias, 0);
    expect(out).toBe(dias);
  });

  it('marca primeiros N domingos como folga dominical configurada', () => {
    const dias = gerarEscala5x2(BR_NOON('2026-06-01'), 21);
    const out = aplicarFolgasDomingoNoMes(dias, 2);
    const domingos = out.filter((d) => new Date(`${d.data}T12:00:00`).getDay() === 0);
    const configurados = domingos.filter((d) => d.folgaDominicalConfigurada);
    expect(configurados.length).toBeGreaterThanOrEqual(1);
    expect(configurados.every((d) => d.tipo === 'folga' || d.tipo === 'fds')).toBe(true);
  });
});

describe('calcularHorasEscala', () => {
  it('soma horas de turno com inicio e fim', () => {
    const res = calcularHorasEscala([
      { data: '2026-06-02', tipo: 'trabalho', horaInicio: '09:00', horaFim: '18:00' },
      { data: '2026-06-03', tipo: 'folga' },
    ]);
    expect(res.diasTrabalho).toBe(1);
    expect(res.horasTrabalhadas).toBe(9);
  });
});

describe('proximaFolga', () => {
  it('retorna primeira folga a partir da referencia', () => {
    const dias = gerarEscala5x2(BR_NOON('2026-06-01'), 14);
    const folga = proximaFolga(dias, '2026-06-01');
    expect(folga).toBeTruthy();
    const dia = dias.find((d) => d.data === folga);
    expect(dia?.tipo).toBe('folga');
  });
});
