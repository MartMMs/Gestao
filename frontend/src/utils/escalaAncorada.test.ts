import { describe, expect, it } from 'vitest';
import { gerarEscalaComRegras, gerarEscala5x1, gerarEscala12x36 } from './escalaCalculator';
import { analisarConformidadeCLT } from './cltValidator';

const porData = (dias: { data: string; tipo: string }[]) => new Map(dias.map((d) => [d.data, d.tipo]));

describe('escala ancorada: a mesma malha qualquer que seja o dia inicial', () => {
  for (const tipo of ['6x1', '5x2', '5x1', '12x36', 'rotativo'] as const) {
    it(`${tipo}: janela da API (7 dias antes) e janela da tela (dia 1) coincidem no mês`, () => {
      const tela = gerarEscalaComRegras({ tipo, dataInicio: '2026-11-01' }, 30, { folgasDomingoNoMes: 2 });
      const api = porData(gerarEscalaComRegras({ tipo, dataInicio: '2026-10-25' }, 37, { folgasDomingoNoMes: 2 }));
      for (const dia of tela) expect([dia.data, api.get(dia.data)]).toEqual([dia.data, dia.tipo]);
    });
  }

  it('6x1 tem uma única folga por semana (domingo)', () => {
    const dias = gerarEscalaComRegras({ tipo: '6x1', dataInicio: '2026-11-09' }, 7);
    expect(dias.filter((d) => d.tipo !== 'trabalho').map((d) => d.data)).toEqual(['2026-11-15']);
  });

  it('5x1 continua o ciclo na virada do mês', () => {
    const outubro = gerarEscala5x1('2026-10-01', 31);
    const novembro = gerarEscala5x1('2026-11-01', 30);
    const emSequencia = gerarEscala5x1('2026-10-01', 61);
    expect([...outubro, ...novembro].map((d) => d.tipo)).toEqual(emSequencia.map((d) => d.tipo));
  });
});

describe('CLT na 12x36', () => {
  it('não acusa excesso de carga pela semana de 48h (art. 59-A: vale a média)', () => {
    const dias = gerarEscala12x36('2026-11-01', 30, { diurno: { inicio: '07:00', fim: '19:00' } });
    const analise = analisarConformidadeCLT(dias, { tipoEscala: '12x36' });
    expect(analise.cargaSemanal.conforme).toBe(true);
    expect(analise.cargaSemanal.cargaTotal).toBeLessThanOrEqual(44);
  });

  it('a mesma malha fora da 12x36 é cobrada semana a semana', () => {
    const dias = gerarEscala12x36('2026-11-01', 30, { diurno: { inicio: '07:00', fim: '19:00' } });
    expect(analisarConformidadeCLT(dias).cargaSemanal.conforme).toBe(false);
  });
});
