import { describe, expect, it } from 'vitest';
import type { DiaEscala } from '../../../utils/escalaCalculator';
import { diasDaSemana, folgasDaSemana, semanaVizinha } from './folgasDaSemana';

// Semana de segunda 23/11/2026 a domingo 29/11/2026
const semana = diasDaSemana('2026-11-25');
const escala = (folgas: Record<string, Partial<DiaEscala>>): DiaEscala[] =>
  semana.map((data) => ({ data, tipo: 'trabalho', ...folgas[data] } as DiaEscala));

describe('folgas da semana', () => {
  it('semana vai de segunda a domingo, e navega de 7 em 7 dias', () => {
    expect(semana[0]).toBe('2026-11-23');
    expect(semana[6]).toBe('2026-11-29');
    expect(semanaVizinha('2026-11-25', 1)).toBe('2026-11-30');
  });

  it('lista quem folga em cada dia; só folga comum futura troca, para dias de trabalho da mesma semana', () => {
    const escalas: Record<string, DiaEscala[]> = {
      a: escala({ '2026-11-26': { tipo: 'folga' } }),
      b: escala({ '2026-11-24': { tipo: 'folga', descricao: 'Férias' }, '2026-11-26': { tipo: 'folga' } }),
      c: escala({ '2026-11-23': { tipo: 'folga' } }),
    };
    const { porDia, feriados } = folgasDaSemana(
      [{ id: 'b', name: 'Bruna' }, { id: 'a', name: 'Ana' }, { id: 'c', name: 'Caio' }],
      (id) => escalas[id],
      '2026-11-25',
      '2026-11-25',
    );
    const quinta = porDia.get('2026-11-26')!;
    expect(quinta.map((f) => f.nome)).toEqual(['Ana', 'Bruna']);
    expect(quinta[0]).toMatchObject({ rotulo: 'Folga', trocavel: true });
    expect(quinta[0].destinos.map((d) => d.data)).toEqual(['2026-11-25', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(porDia.get('2026-11-24')![0]).toMatchObject({ nome: 'Bruna', rotulo: 'Férias', trocavel: false });
    // Folga que já passou não troca
    expect(porDia.get('2026-11-23')![0]).toMatchObject({ nome: 'Caio', trocavel: false });
    expect(feriados.size).toBe(0);
  });

  it('feriado vai uma vez no dia e não aparece ao lado de cada pessoa', () => {
    const comFeriado = escala({ '2026-11-27': { tipo: 'folga', feriadoNome: 'Feriado Teste' } });
    const { porDia, feriados } = folgasDaSemana([{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bia' }], () => comFeriado, '2026-11-25', '2026-11-25');
    expect(feriados.get('2026-11-27')).toBe('Feriado Teste');
    expect(porDia.get('2026-11-27')).toEqual([]);
  });

  it('férias ou atestado num feriado continuam listados com a tag da ausência; o resto da equipe some', () => {
    const escalas: Record<string, DiaEscala[]> = {
      ferias: escala({ '2026-11-27': { tipo: 'folga', feriadoNome: 'Feriado Teste', descricao: 'Férias' } }),
      atestado: escala({ '2026-11-27': { tipo: 'folga', feriadoNome: 'Feriado Teste', descricao: 'Atestado médico' } }),
      feriado: escala({ '2026-11-27': { tipo: 'folga', feriadoNome: 'Feriado Teste' } }),
    };
    const { porDia, feriados } = folgasDaSemana(
      [{ id: 'ferias', name: 'Fábio' }, { id: 'atestado', name: 'Alice' }, { id: 'feriado', name: 'Zeca' }],
      (id) => escalas[id], '2026-11-25', '2026-11-25',
    );
    expect(feriados.get('2026-11-27')).toBe('Feriado Teste');
    expect(porDia.get('2026-11-27')!.map((f) => [f.nome, f.rotulo, f.trocavel])).toEqual([
      ['Alice', 'Atestado médico', false],
      ['Fábio', 'Férias', false],
    ]);
  });
});
