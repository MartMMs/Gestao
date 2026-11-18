import { describe, expect, it, vi } from 'vitest';
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

import { createHash, randomBytes } from 'node:crypto';
import { aesEncryptGCM, hmacSign, proto } from 'baileys';

// Redis em memória para o teste (as chaves de enquete e o mapa @lid ficam nele)
const redis = vi.hoisted(() => new Map<string, string>());
vi.mock('./redisService', () => ({ redisService: { get: async (k: string) => redis.get(k) ?? null, set: async (k: string, v: string) => { redis.set(k, v); } } }));
vi.mock('../db', () => ({ prisma: {} }));
const { codigoDesconexao, esperaReconexao, lerMensagemRecebida, lerVoto, opcaoVotada } = await import('./whatsappQr');

describe('mensagens recebidas e reconexão', () => {
  it('conversa individual: número do chat, ou de senderPn quando o chat vem em @lid; grupos e as próprias ficam de fora', () => {
    const msg = (key: object, texto = '2') => ({ key, message: { conversation: texto } });
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net' }))).toMatchObject({ jid: '5511987654321@s.whatsapp.net', destino: '5511987654321@s.whatsapp.net', lid: null, texto: '2' });
    expect(lerMensagemRecebida(msg({ remoteJid: '123@lid', senderPn: '5511987654321@s.whatsapp.net' }))).toMatchObject({ jid: '5511987654321@s.whatsapp.net', destino: '123@lid', lid: '123@lid', texto: '2' });
    // @lid sem senderPn: não descarta mais; o número sai do mapa gravado no envio do lembrete
    expect(lerMensagemRecebida(msg({ remoteJid: '123@lid' }))).toMatchObject({ jid: null, lid: '123@lid', texto: '2' });
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net', fromMe: true }))).toBeNull();
    expect(lerMensagemRecebida(msg({ remoteJid: '1203630@g.us' }))).toBeNull();
    expect(lerMensagemRecebida(msg({ remoteJid: '5511987654321@s.whatsapp.net' }, ''))).toBeNull();
    expect(lerMensagemRecebida({ key: { remoteJid: '5511987654321@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'sim' } } })?.texto).toBe('sim');
  });

  it('clique em botão (qualquer formato) vira a mesma resposta do texto', () => {
    const chat = { remoteJid: '123@lid', senderPn: '556282345678@s.whatsapp.net' };
    expect(lerMensagemRecebida({ key: chat, message: { buttonsResponseMessage: { selectedButtonId: 'confirmar_nao' } } })?.texto).toBe('2');
    expect(lerMensagemRecebida({ key: chat, message: { templateButtonReplyMessage: { selectedId: 'confirmar_sim' } } })?.texto).toBe('1');
    expect(lerMensagemRecebida({ key: chat, message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"confirmar_nao"}' } } } })?.texto).toBe('2');
  });

  it('voto na enquete: lê a opção mesmo com o votante em @lid (chave guardada no envio)', async () => {
    const opcoes = ['Sim, confirmo', 'Não poderei ir'];
    const segredo = randomBytes(32);
    const pollId = 'POLL123';
    const criador = '5511900000000@s.whatsapp.net';
    const votante = '777@lid';
    // Cifra o voto como o WhatsApp faz (mesmo algoritmo do decryptPollVote do Baileys)
    const sign = Buffer.concat([Buffer.from(pollId), Buffer.from(criador), Buffer.from(votante), Buffer.from('Poll Vote'), new Uint8Array([1])]);
    const chave = hmacSign(sign, hmacSign(segredo, new Uint8Array(32), 'sha256'), 'sha256');
    const encIv = randomBytes(12);
    const conteudo = proto.Message.PollVoteMessage.encode({ selectedOptions: [createHash('sha256').update(opcoes[1]).digest()] }).finish();
    const encPayload = aesEncryptGCM(conteudo, chave, encIv, Buffer.from(`${pollId}\u0000${votante}`));
    redis.set(`wa-enquete:${pollId}`, JSON.stringify({ segredo: segredo.toString('base64'), jid: '556282345678@s.whatsapp.net', opcoes }));

    const m = { key: { remoteJid: votante }, message: { pollUpdateMessage: { pollCreationMessageKey: { id: pollId }, vote: { encPayload, encIv } } } };
    const recebida = lerMensagemRecebida(m)!;
    expect(recebida.enquete?.pollId).toBe(pollId);
    expect(await lerVoto({ user: { id: '5511900000000:3@s.whatsapp.net' } }, m, recebida.enquete!, null)).toBe('2');
    expect(opcaoVotada([createHash('sha256').update(opcoes[0]).digest()], opcoes)).toBe(0);
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
