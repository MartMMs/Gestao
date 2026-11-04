import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bitsZeroIniciais, provaValida, resolverDesafio, sha256Ascii, sha256HexAscii } from '@shared/provaDeTrabalho';

describe('prova de trabalho do login', () => {
  it('SHA-256 em JS puro bate com o do Node (vetores conhecidos e textos de vários tamanhos)', () => {
    expect(sha256HexAscii('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexAscii('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    for (const tamanho of [1, 55, 56, 63, 64, 65, 119, 200]) {
      const texto = 'a1:'.repeat(Math.ceil(tamanho / 3)).slice(0, tamanho);
      expect(sha256HexAscii(texto)).toBe(createHash('sha256').update(texto).digest('hex'));
    }
  });

  it('conta os bits zerados do começo', () => {
    expect(bitsZeroIniciais(new Uint32Array([0x0000ffff, 1]))).toBe(16);
    expect(bitsZeroIniciais(new Uint32Array([0, 0x10000000]))).toBe(35);
    expect(bitsZeroIniciais(new Uint32Array([0x80000000]))).toBe(0);
  });

  it('resolve o desafio, e a prova só vale para o mesmo prefixo e dificuldade', async () => {
    const desafio = { prefixo: 'a3f9c2', dificuldade: 12 };
    const nonce = await resolverDesafio(desafio);
    expect(provaValida(desafio.prefixo, nonce, 12)).toBe(true);
    expect(bitsZeroIniciais(sha256Ascii(`a3f9c2:${nonce}`))).toBeGreaterThanOrEqual(12);
    expect(provaValida('outro', nonce, 12)).toBe(false);
    // Nonce que não é número curto é recusado sem calcular nada
    expect(provaValida(desafio.prefixo, `${nonce}x`, 12)).toBe(false);
    expect(provaValida(desafio.prefixo, '1'.repeat(13), 1)).toBe(false);
  });
});
