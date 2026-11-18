import { describe, expect, it } from 'vitest';
import { criarContadorDiario, esperaAteProximo, jidDoTelefone } from './whatsappQr';

describe('WhatsApp por QR code', () => {
  it('contador: respeita o limite e zera na virada do dia em Brasília', () => {
    const contador = criarContadorDiario(2);
    const noite = new Date('2026-12-11T02:30:00Z'); // 23:30 do dia 10 em Brasília
    contador.registrar(noite);
    contador.registrar(noite);
    expect(contador.restantes(noite)).toBe(0);
    expect(contador.restantes(new Date('2026-12-11T03:01:00Z'))).toBe(2); // 00:01 do dia 11
  });

  it('pausa: primeiro envio na hora, depois entre 30 s e 90 s', () => {
    expect(esperaAteProximo(null, 1000)).toBe(0);
    expect(esperaAteProximo(0, 10_000, 0)).toBe(20_000);
    expect(esperaAteProximo(0, 10_000, 1)).toBe(80_000);
    expect(esperaAteProximo(0, 200_000, 0.5)).toBe(0);
  });

  it('jid: DDI 55 e sem máscara', () => {
    expect(jidDoTelefone('(11) 98765-4321')).toBe('5511987654321@s.whatsapp.net');
    expect(jidDoTelefone('5511987654321')).toBe('5511987654321@s.whatsapp.net');
  });
});

import { codigoDesconexao, esperaReconexao, lerMensagemRecebida } from './whatsappQr';

describe('mensagens recebidas e reconexão', () => {
  it('só conversa individual de outra pessoa, com texto; @lid usa o número de senderPn', () => {
    const msg = (key: object, texto = '2') => ({ key, message: { conversation: texto } });
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net' }))).toEqual({ jid: '5511987654321@s.whatsapp.net', destino: '5511987654321@s.whatsapp.net', texto: '2' });
    expect(lerMensagemRecebida(msg({ remoteJid: '123@lid', senderPn: '5511987654321@s.whatsapp.net' }))).toEqual({ jid: '5511987654321@s.whatsapp.net', destino: '123@lid', texto: '2' });
    expect(lerMensagemRecebida(msg({ remoteJid: '123@lid' }))).toBeNull();
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net', fromMe: true }))).toBeNull();
    expect(lerMensagemRecebida(msg({ remoteJid: '1203630@g.us' }))).toBeNull();
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net' }, ''))).toBeNull();
    expect(lerMensagemRecebida({ key: { remoteJid: '5511987654321@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'sim' } } })?.texto).toBe('sim');
  });

  it('código da desconexão sem confiar no formato', () => {
    expect(codigoDesconexao({ output: { statusCode: 401 } })).toBe(401);
    expect(codigoDesconexao(new Error('x'))).toBeUndefined();
    expect(codigoDesconexao(undefined)).toBeUndefined();
  });

  it('reconexão espera cada vez mais e desiste depois de 6 tentativas', () => {
    expect([0, 1, 2, 5].map(esperaReconexao)).toEqual([5000, 10_000, 20_000, 120_000]);
    expect(esperaReconexao(6)).toBeNull();
  });
});
