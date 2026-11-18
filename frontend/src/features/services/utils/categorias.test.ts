import { describe, expect, it } from 'vitest';
import { agruparCategorias, montarCategoria, separarCategoria } from './categorias';

describe('grupos de categoria', () => {
  it('monta e separa "Grupo › Nome"; sem grupo (ou Geral) fica só o nome', () => {
    expect(montarCategoria('Massagens', 'Relaxante')).toBe('Massagens › Relaxante');
    expect(montarCategoria('', 'Consulta')).toBe('Consulta');
    expect(montarCategoria('Geral', 'Consulta')).toBe('Consulta');
    expect(separarCategoria('Massagens › Relaxante')).toEqual({ grupo: 'Massagens', nome: 'Relaxante' });
    expect(separarCategoria('Consulta')).toEqual({ grupo: 'Geral', nome: 'Consulta' });
    // O "›" digitado sai do texto; só ele (ou espaços) não é nome
    expect(montarCategoria('Massagens', 'Pedras › Quentes')).toBe('Massagens › Pedras Quentes');
    expect(montarCategoria('Massagens', ' › ')).toBe('');
  });

  it('agrupa sem repetir, Geral primeiro', () => {
    expect(agruparCategorias(['Massagens › B', 'Consulta', 'Estética › A', 'Massagens › A', 'Consulta', ''])).toEqual([
      { grupo: 'Geral', categorias: ['Consulta'] },
      { grupo: 'Estética', categorias: ['Estética › A'] },
      { grupo: 'Massagens', categorias: ['Massagens › A', 'Massagens › B'] },
    ]);
  });
});
