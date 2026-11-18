import { describe, expect, it } from 'vitest';
import { preencherMensagem, trechosMensagem, validarMensagensLembrete } from '@shared/mensagemLembrete';

describe('mensagem de lembrete', () => {
  it('reconhece chaves sem ligar para acento e maiúscula', () => {
    expect(trechosMensagem('Oi {Nome}, reserva {Número da Reserva} {xyz}')).toEqual([
      { texto: 'Oi ', tipo: 'texto' },
      { texto: '{Nome}', tipo: 'chave' },
      { texto: ', reserva ', tipo: 'texto' },
      { texto: '{Número da Reserva}', tipo: 'chave' },
      { texto: ' ', tipo: 'texto' },
      { texto: '{xyz}', tipo: 'desconhecida' },
    ]);
  });

  it('preenche e deixa vazio o que não tem informação', () => {
    expect(preencherMensagem('{nome}, {horario} em {endereco}.', { nome: 'Maria', horario: '10:30' })).toBe('Maria, 10:30 em .');
  });

  it('valida: vazia, chave desconhecida e ok', () => {
    expect(validarMensagensLembrete([' '])).toMatch('vazia');
    expect(validarMensagensLembrete(['Oi {nomi}'])).toMatch('{nomi}');
    expect(validarMensagensLembrete(['Oi {nome}'])).toBeNull();
  });
});
