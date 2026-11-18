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

import { interpretarResposta, telefoneDoWhatsapp } from '@shared/mensagemLembrete';

describe('resposta ao lembrete', () => {
  it('entende 1/2, sim/não com ou sem acento, e ignora o resto', () => {
    expect(interpretarResposta(' 1 ')).toBe('sim');
    expect(interpretarResposta('Sim, confirmo!')).toBe('sim');
    expect(interpretarResposta('2')).toBe('nao');
    expect(interpretarResposta('Não poderei ir')).toBe('nao');
    expect(interpretarResposta('NAO')).toBe('nao');
    expect(interpretarResposta('Bom dia, qual o endereço?')).toBeNull();
    expect(interpretarResposta('simples')).toBeNull();
  });

  it('número do WhatsApp vira o telefone do cadastro, devolvendo o 9 do celular', () => {
    expect(telefoneDoWhatsapp('5511987654321@s.whatsapp.net')).toBe('11987654321');
    expect(telefoneDoWhatsapp('551187654321@s.whatsapp.net')).toBe('11987654321');
    expect(telefoneDoWhatsapp('551133334444@s.whatsapp.net')).toBe('1133334444');
  });
});

import { telefoneParaResposta } from '@shared/mensagemLembrete';

describe('telefone do envio e da resposta', () => {
  it('o cadastro e o WhatsApp chegam à mesma chave, com ou sem máscara, DDI e o 9', () => {
    const chave = telefoneDoWhatsapp('551187654321@s.whatsapp.net');
    for (const gravado of ['11987654321', '(11) 98765-4321', '5511987654321', '1187654321']) expect(telefoneParaResposta(gravado)).toBe(chave);
  });
});

import { PREFIXO_TOTEM, declaracaoDoTotem } from '@shared/anamnese';

describe('declaração do totem', () => {
  it('lê a linha no formato que o totem grava', () => {
    expect(declaracaoDoTotem(`${PREFIXO_TOTEM}2026-11-10]: Alergia a amendoim`)).toBe('2026-11-10: Alergia a amendoim');
    expect(declaracaoDoTotem('texto comum')).toBe('texto comum');
  });
});
