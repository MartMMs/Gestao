import { describe, expect, it } from 'vitest';
import { gerarEscalaComRegras } from '../../shared/escala';
import { montarMinhaEscala } from './minhaEscalaService';

const dias = [
  { data: '2026-11-22', tipo: 'trabalho' as const, turno: '09:00-18:00', horaInicio: '09:00', horaFim: '18:00' },
  { data: '2026-11-23', tipo: 'folga' as const, descricao: 'Férias' },
  { data: '2026-11-24', tipo: 'folga' as const, descricao: 'Atestado médico' },
  { data: '2026-11-25', tipo: 'folga' as const, feriadoNome: 'Feriado X' },
  { data: '2026-11-26', tipo: 'folga' as const },
  { data: '2026-12-01', tipo: 'folga' as const },
];

describe('montarMinhaEscala', () => {
  const r = montarMinhaEscala(dias, '2026-11', '2026-11-22', new Map([['09:00-18:00', 'Comercial']]), new Date('2026-11-20T10:00:00Z'));

  it('classifica os tipos sem expor o motivo da ausência', () => {
    expect(r.dias.map((d) => d.tipo)).toEqual(['trabalho', 'ferias', 'afastamento', 'feriado', 'folga']);
    expect(r.dias[2].descricao).toBeNull();
    expect(r.dias[0]).toMatchObject({ turno: '09:00-18:00', turnoNome: 'Comercial' });
  });

  it('resumo: hoje, amanhã e próxima folga comum (pula férias, atestado e feriado)', () => {
    expect(r.resumo.hoje?.tipo).toBe('trabalho');
    expect(r.resumo.amanha?.tipo).toBe('ferias');
    expect(r.resumo.proximaFolga).toBe('2026-11-26');
    expect(r.resumo.atualizadaEm).toBe('2026-11-20T10:00:00.000Z');
  });

  it('só devolve os dias do mês pedido', () => {
    expect(r.dias.every((d) => d.data.startsWith('2026-11-'))).toBe(true);
  });
});

describe('gerador com turno padrão', () => {
  it('nenhum dia de trabalho fica sem turno', () => {
    const escala = gerarEscalaComRegras({ tipo: '6x1', dataInicio: '2026-12-01' }, 31, { folgasDomingoNoMes: 2, turnoPadrao: '09:00-18:00' });
    const trabalho = escala.filter((d) => d.tipo === 'trabalho');
    expect(trabalho.length).toBeGreaterThan(20);
    expect(trabalho.every((d) => d.turno === '09:00-18:00')).toBe(true);
  });
});
