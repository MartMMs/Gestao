import { describe, expect, it } from 'vitest';
import { aplicarAjusteEscala, gerarEscalaComRegras, type DiaEscala } from '../../../utils/escalaCalculator';
import { analisarConformidadeCLT, analisarInterjornadaEscala, calcularMaiorCargaSemanal, horasDoDia, horasExtrasNoMes, horasPorSemana } from '../../../utils/cltValidator';
import { analisarMes, categoriaDoTurno, turnoDoDia } from './turnos';
import { corrigirViolacoesClt, preencher12x36, repetirMesAnterior } from './modelosEscala';

const mes = (tipo: '6x1' | '5x2' | '5x1' | '12x36' | 'rotativo', inicio: string, dias: number) =>
  gerarEscalaComRegras({ tipo, dataInicio: inicio }, dias, { folgasDomingoNoMes: 0 });

describe('horas x sem turno (mesma regra)', () => {
  it('dia só com o campo turno soma horas e não é "sem turno"', () => {
    const a = analisarMes([{ data: '2026-11-10', tipo: 'trabalho', turno: '08:00-17:00' }], '2026-11-');
    expect({ semTurno: a.diasSemTurno, horas: a.horasMes }).toEqual({ semTurno: 0, horas: 8 });
  });
  it('horário ilegível é "sem turno" e não soma horas', () => {
    const a = analisarMes([{ data: '2026-11-10', tipo: 'trabalho', horaInicio: '8:00', horaFim: '17:00' }], '2026-11-');
    expect({ semTurno: a.diasSemTurno, horas: a.horasMes }).toEqual({ semTurno: 1, horas: 0 });
  });
});

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
    expect(turno('08:00', '12:15')).toBe(4); // 4h15: 15 min de pausa, 4h de trabalho
    expect(turno('08:00', '12:05')).toBe(4); // 4h05 não cabe 4h05 de trabalho com 15 min de pausa: fica 4h
    expect(turno('08:00', '14:00')).toBe(5.75);
    expect(turno('08:00', '14:15')).toBe(6);
    expect(turno('08:00', '14:30')).toBe(6); // 6h de trabalho + 30 min de pausa cabem
    expect(turno('08:00', '15:00')).toBe(6);
    expect(turno('08:00', '15:30')).toBe(6.5);
  });

  it('turno mais longo nunca conta menos horas de trabalho', () => {
    let anterior = 0;
    for (let minutos = 0; minutos < 16 * 60; minutos += 5) {
      const fim = `${String(8 + Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
      const horas = horasDoDia({ data: '2026-11-10', tipo: 'trabalho', horaInicio: '08:00', horaFim: fim });
      expect(horas, `08:00-${fim}`).toBeGreaterThanOrEqual(anterior);
      anterior = horas;
    }
  });

  it('semana que comporta 45h de trabalho passa de 44h', () => {
    const dias = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12']
      .map((data, i): DiaEscala => ({ data, tipo: 'trabalho', horaInicio: '08:00', horaFim: i < 3 ? '18:00' : '14:30' }));
    const analise = analisarConformidadeCLT(dias);
    expect(analise.cargaSemanal.cargaTotal).toBe(45);
    expect(analise.cargaSemanal.conforme).toBe(false);
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

describe('corrigirViolacoesClt (Propor folgas na grade do painel de conformidade)', () => {
  it('propõe folgas só no mês e deixa a escala conforme', () => {
    // Novembro inteiro sem folga, com um turno da noite colado no da manhã: 7º dia, interjornada e semana acima de 44h
    const escala = mes('6x1', '2026-10-01', 92).map((dia) => (dia.data.startsWith('2026-11-')
      ? { ...dia, tipo: 'trabalho' as const, turno: '08:00-18:00', horaInicio: '08:00', horaFim: '18:00' }
      : dia));
    const noite = escala.findIndex((dia) => dia.data === '2026-11-10');
    escala[noite] = { ...escala[noite], turno: '14:00-23:00', horaInicio: '14:00', horaFim: '23:00' };
    expect(analisarMes(escala, '2026-11-', '6x1').conforme).toBe(false);

    const ajustes = corrigirViolacoesClt('c1', escala, '2026-11-', '6x1');
    expect(ajustes.length).toBeGreaterThan(0);
    expect(ajustes.every((a) => a.data.startsWith('2026-11-') && a.tipo === 'folga' && a.colaboradorId === 'c1')).toBe(true);
    const corrigida = escala.map((dia) => (ajustes.some((a) => a.data === dia.data)
      ? { ...dia, tipo: 'folga' as const, turno: undefined, horaInicio: undefined, horaFim: undefined }
      : dia));
    expect(analisarMes(corrigida, '2026-11-', '6x1').conforme).toBe(true);
  });

  it('escala conforme não recebe proposta', () => {
    expect(corrigirViolacoesClt('c1', mes('6x1', '2026-10-01', 92), '2026-11-', '6x1')).toEqual([]);
  });
});

describe('horasExtrasNoMes', () => {
  const dia = (data: string, horaFim: string): DiaEscala => ({ data, tipo: 'trabalho', horaInicio: '08:00', horaFim });
  // Semana de 26/10 (seg) a 01/11 (dom), 7 dias de 9h = 63h: 19h extras, 10h em outubro (6 dias = 54h) e 9h em novembro
  const semana = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].map((d) => dia(d, '18:00'));
  it('conta a semana inteira na virada do mês e põe o excedente nos últimos dias', () => {
    const porDia = horasDoDia(semana[0]);
    expect(porDia).toBe(9);
    expect(horasExtrasNoMes(semana, '2026-11-')).toBe(9);
    expect(horasExtrasNoMes(semana, '2026-10-')).toBe(10);
  });
  it('bate com a maior carga semanal do alerta CLT', () => {
    expect(horasExtrasNoMes(semana, '2026-10-') + horasExtrasNoMes(semana, '2026-11-')).toBe(calcularMaiorCargaSemanal(semana).horas - 44);
  });
  it('duas semanas no mesmo mês somam as extras de cada uma (sem compensar uma com a outra)', () => {
    // 09/11 a 15/11: 6 dias de 9h = 54h (10h extras); 16/11 a 22/11: 4 dias de 9h = 36h (nenhuma extra)
    const duas = [
      ...['09', '10', '11', '12', '13', '14'].map((d) => dia(`2026-11-${d}`, '18:00')),
      ...['16', '17', '18', '19'].map((d) => dia(`2026-11-${d}`, '18:00')),
    ];
    expect(horasExtrasNoMes(duas, '2026-11-')).toBe(10);
  });
  it('folga no meio da semana não conta hora', () => {
    // 6 dias de 9h com uma folga na quarta: 54h, 10h extras
    const comFolga: DiaEscala[] = [
      ...['09', '10'].map((d) => dia(`2026-11-${d}`, '18:00')),
      { data: '2026-11-11', tipo: 'folga' },
      ...['12', '13', '14', '15'].map((d) => dia(`2026-11-${d}`, '18:00')),
    ];
    expect(horasExtrasNoMes(comFolga, '2026-11-')).toBe(10);
  });
});

describe('horasPorSemana', () => {
  it('soma por semana de segunda a domingo, com a semana que cruza o mês inteira', () => {
    const dia = (data: string): DiaEscala => ({ data, tipo: 'trabalho', horaInicio: '08:00', horaFim: '18:00' });
    const porSemana = horasPorSemana(['2026-10-31', '2026-11-01', '2026-11-02'].map(dia));
    expect([...porSemana]).toEqual([['2026-10-26', 18], ['2026-11-02', 9]]);
  });
});
