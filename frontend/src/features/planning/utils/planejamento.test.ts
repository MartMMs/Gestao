import { describe, expect, it } from 'vitest';
import { aplicarAjusteEscala, gerarEscalaComRegras, type DiaEscala } from '../../../utils/escalaCalculator';
import { analisarConformidadeCLT, analisarInterjornadaEscala, horasDoDia } from '../../../utils/cltValidator';
import { analisarMes, categoriaDoTurno, turnoDoDia } from './turnos';
import { preencher12x36, repetirMesAnterior } from './modelosEscala';

const mes = (tipo: '6x1' | '5x2' | '5x1' | '12x36' | 'rotativo', inicio: string, dias: number) =>
  gerarEscalaComRegras({ tipo, dataInicio: inicio }, dias, { folgasDomingoNoMes: 0 });

describe('turnos', () => {
  it('lê o horário do dia e não inventa 08:00', () => {
    expect(turnoDoDia({ data: '2026-11-10', tipo: 'trabalho', turno: 'Diurno', horaInicio: '07:00', horaFim: '19:00' })).toBe('07:00-19:00');
    expect(turnoDoDia({ data: '2026-11-10', tipo: 'trabalho', turno: 'Diurno' })).toBeUndefined();
    expect(turnoDoDia({ data: '2026-11-10', tipo: 'folga' })).toBeUndefined();
  });

  it('classifica pelo início e pelo fim, uma regra só', () => {
    expect(categoriaDoTurno('08:00-18:00')).toBe('comercial');
    expect(categoriaDoTurno('07:00-19:00')).toBe('comercial');
    expect(categoriaDoTurno('08:00-17:30')).toBe('comercial');
    expect(categoriaDoTurno('06:00-14:00')).toBe('manha');
    expect(categoriaDoTurno('14:00-22:00')).toBe('tarde');
    expect(categoriaDoTurno('22:00-06:00')).toBe('noite');
    expect(categoriaDoTurno('Diurno')).toBeNull();
  });

  it('horas do dia descontam o intervalo mínimo da CLT (art. 71), na mesma conta do backend', () => {
    const turno = (horaInicio: string, horaFim: string) => horasDoDia({ data: '2026-11-10', tipo: 'trabalho', horaInicio, horaFim });
    expect(turno('08:00', '18:00')).toBe(9); // acima de 6h: 1h
    expect(turno('22:00', '06:00')).toBe(7); // vira a meia-noite
    expect(turno('08:00', '13:00')).toBe(4.75); // entre 4h e 6h: 15 min
    expect(turno('08:00', '12:00')).toBe(4); // até 4h: sem intervalo
  });

  it('5x2 das 08h às 17h fecha 40h na semana e não acusa excesso', () => {
    const semana = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11']
      .map((data): DiaEscala => ({ data, tipo: 'trabalho', horaInicio: '08:00', horaFim: '17:00' }));
    const analise = analisarConformidadeCLT(semana);
    expect(analise.cargaSemanal.cargaTotal).toBe(40);
    expect(analise.cargaSemanal.conforme).toBe(true);
  });

  it('interjornada de 10h58 não passa como 11h', () => {
    const dias: DiaEscala[] = [
      { data: '2026-11-10', tipo: 'trabalho', horaInicio: '08:00', horaFim: '21:02' },
      { data: '2026-11-11', tipo: 'trabalho', horaInicio: '08:00', horaFim: '17:00' },
    ];
    expect(analisarInterjornadaEscala(dias).conforme).toBe(false);
  });
});

describe('repetir o mês anterior', () => {
  it('sem ajustes no mês anterior, não muda nada (o ciclo já continua)', () => {
    for (const tipo of ['6x1', '5x2', '5x1', '12x36', 'rotativo'] as const) {
      expect(repetirMesAnterior('c1', mes(tipo, '2026-10-01', 31), mes(tipo, '2026-11-01', 30), tipo)).toEqual([]);
    }
  });

  it('12x36 não vira dois plantões seguidos', () => {
    const plantaoDe = mes('12x36', '2026-10-01', 31).find((d) => d.tipo === 'trabalho' && d.data > '2026-10-15')!.data;
    const outubro = mes('12x36', '2026-10-01', 31).map((dia) =>
      dia.data === plantaoDe ? aplicarAjusteEscala(dia, { tipo: 'folga' }) : dia);
    const novembro = mes('12x36', '2026-11-01', 30);
    const ajustes = repetirMesAnterior('c1', outubro, novembro, '12x36');
    expect(ajustes).toHaveLength(1); // só o plantão que virou folga, 28 dias depois
    expect(ajustes[0].tipo).toBe('folga');
    const porData = new Map(ajustes.map((a) => [a.data, a]));
    const resultado = novembro.map((dia) => aplicarAjusteEscala(dia, porData.get(dia.data)));
    for (let i = 1; i < resultado.length; i += 1) {
      expect(resultado[i - 1].tipo === 'trabalho' && resultado[i].tipo === 'trabalho').toBe(false);
    }
  });

  it('leva o ajuste salvo do mês anterior para o mesmo ponto do ciclo', () => {
    const outubro = mes('6x1', '2026-10-01', 31).map((dia) =>
      dia.data === '2026-10-14' ? aplicarAjusteEscala(dia, { tipo: 'folga' }) : dia);
    const ajustes = repetirMesAnterior('c1', outubro, mes('6x1', '2026-11-01', 30), '6x1');
    expect(ajustes.map((a) => [a.data, a.tipo])).toEqual([['2026-11-11', 'folga']]); // 28 dias depois, mesma quarta
  });

  it('feriado do mês atual continua feriado', () => {
    const outubro = mes('6x1', '2026-10-01', 31).map((dia) =>
      aplicarAjusteEscala(dia, { tipo: 'trabalho', turno: '09:00-17:00' }));
    const ajustes = repetirMesAnterior('c1', outubro, mes('6x1', '2026-11-01', 30), '6x1');
    expect(ajustes.some((a) => a.data === '2026-11-02' || a.data === '2026-11-15' || a.data === '2026-11-20')).toBe(false);
  });
});

describe('padrão 12x36', () => {
  it('só propõe os dias que mudam, com horário legível pela API', () => {
    const ajustes = preencher12x36('c1', mes('6x1', '2026-11-01', 30));
    expect(ajustes.length).toBeGreaterThan(0);
    for (const ajuste of ajustes) {
      if (ajuste.tipo === 'trabalho') expect(ajuste.turno).toBe('07:00-19:00');
      else expect(ajuste.turno).toBeUndefined();
    }
    expect(preencher12x36('c1', mes('12x36', '2026-11-01', 30))).toEqual([]);
  });
});

describe('analisarMes (calendário e painel lateral usam a mesma conta)', () => {
  const trabalho = (data: string, inicio: string, fim: string): DiaEscala => ({ data, tipo: 'trabalho', horaInicio: inicio, horaFim: fim });

  it('vê a interjornada curta na virada do mês e marca o dia do mês aberto', () => {
    const escala = [trabalho('2026-11-30', '14:00', '23:00'), trabalho('2026-12-01', '06:00', '14:00')];
    const analise = analisarMes(escala, '2026-12-');
    expect(analise.conforme).toBe(false);
    expect([...analise.interjornada.keys()]).toEqual([1]);
    expect(analisarMes(escala, '2026-11-').interjornada.size).toBe(0); // o alerta é do dia 1, não do mês anterior
  });

  it('dia sem turno não soma horas, mas é contado à parte', () => {
    const analise = analisarMes([{ data: '2026-12-02', tipo: 'trabalho' }, trabalho('2026-12-03', '08:00', '18:00')], '2026-12-');
    expect(analise.horasMes).toBe(9);
    expect(analise.diasSemTurno).toBe(1);
  });
});
