// WhatsApp por QR code (WhatsApp Web, via Baileys), só para os lembretes de 24h. Não é a API oficial: o número pode
// ser bloqueado se mandar muito. Por isso: no máximo LIMITE_POR_DIA mensagens, uma pausa aleatória entre elas, só
// para quem tem WhatsApp, e nada de responder ou ficar "online". Trocar pela API oficial = outro WhatsappProvider.
// shortcut: sessão em arquivo no servidor e uma instância só; com várias instâncias da API, só uma deve conectar.

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, type WASocket } from 'baileys';
import QRCode from 'qrcode';
import { normalizarTelefone } from '../../shared/validadores';
import { diaISODe as diaBR } from '../../shared/datasBR';
import type { WhatsappProvider } from './whatsapp';

export const LIMITE_POR_DIA = 40;
const PAUSA_MIN_MS = 30_000;
const PAUSA_MAX_MS = 90_000;
const PASTA_SESSAO = process.env.WHATSAPP_QR_PASTA
  || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.whatsapp-sessao');

export type StatusWhatsappQr = 'desconectado' | 'iniciando' | 'aguardando_qr' | 'conectado';


/** Conta envios do dia (fuso de Brasília); zera sozinho na virada */
export const criarContadorDiario = (limite: number) => {
  let dia = '';
  let total = 0;
  const hoje = (agora: Date) => {
    if (diaBR(agora) !== dia) { dia = diaBR(agora); total = 0; }
    return total;
  };
  return {
    restantes: (agora = new Date()) => Math.max(0, limite - hoje(agora)),
    registrar: (agora = new Date()) => { hoje(agora); total += 1; },
  };
};

/** Pausa até o próximo envio: aleatória entre min e max desde o último (o primeiro sai na hora) */
export const esperaAteProximo = (ultimoEnvio: number | null, agora: number, sorteio = Math.random()) =>
  ultimoEnvio === null ? 0 : Math.max(0, ultimoEnvio + PAUSA_MIN_MS + sorteio * (PAUSA_MAX_MS - PAUSA_MIN_MS) - agora);

/** 11987654321 → 5511987654321@s.whatsapp.net */
export const jidDoTelefone = (telefone: string) => `55${normalizarTelefone(telefone)}@s.whatsapp.net`;

type MensagemBaileys = { key: { remoteJid?: string | null; fromMe?: boolean | null; senderPn?: string | null }; message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null };

/**
 * Mensagem que chegou: só conversa individual de outra pessoa, com texto. Contas novas do WhatsApp chegam com um id
 * "@lid"; o número de verdade vem em senderPn. `destino` é para onde responder (o mesmo chat)
 */
export const lerMensagemRecebida = (m: MensagemBaileys): { jid: string; destino: string; texto: string } | null => {
  const destino = m.key.remoteJid;
  if (!destino || m.key.fromMe) return null;
  const jid = destino.endsWith('@lid') ? m.key.senderPn : destino;
  if (!jid?.endsWith('@s.whatsapp.net')) return null;
  const texto = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? '';
  return texto ? { jid, destino, texto } : null;
};

/** Código HTTP do erro de desconexão do Baileys (Boom.output.statusCode), sem confiar no formato */
export const codigoDesconexao = (erro: unknown): number | undefined => {
  const output = erro && typeof erro === 'object' ? (erro as { output?: unknown }).output : undefined;
  const codigo = output && typeof output === 'object' ? (output as { statusCode?: unknown }).statusCode : undefined;
  return typeof codigo === 'number' ? codigo : undefined;
};

export const MAX_TENTATIVAS_RECONEXAO = 6;
/** 5 s, 10 s, 20 s... até 2 min; null = desistir */
export const esperaReconexao = (tentativa: number) => (tentativa >= MAX_TENTATIVAS_RECONEXAO ? null : Math.min(120_000, 5000 * 2 ** tentativa));

const silencioso = {
  level: 'silent',
  child: () => silencioso,
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
};

// shortcut: estado da conexão em variáveis do módulo (uma conexão por processo); se precisar de vários números ou
// de testar a conexão inteira, transformar em uma fábrica criarWhatsappQr({ pasta, dormir, criarSocket })
let sock: WASocket | null = null;
let status: StatusWhatsappQr = 'desconectado';
let qrImagem: string | null = null;
let numero: string | null = null;
let ultimoEnvio: number | null = null;
let tentativasReconexao = 0;
type RecebeMensagem = (jid: string, texto: string, responder: (texto: string) => Promise<void>) => Promise<void>;
let aoReceber: RecebeMensagem | null = null;
/** Quem trata as respostas dos clientes (o servidor liga na subida) */
export const aoReceberMensagemWhatsapp = (fn: RecebeMensagem) => { aoReceber = fn; };
const contador = criarContadorDiario(LIMITE_POR_DIA);

export const estadoWhatsappQr = () => ({
  status,
  qr: status === 'aguardando_qr' ? qrImagem : null,
  numero,
  enviadosHoje: LIMITE_POR_DIA - contador.restantes(),
  limitePorDia: LIMITE_POR_DIA,
});

let conectando = false;
export const conectarWhatsappQr = async () => {
  // Dois cliques seguidos não podem abrir duas conexões no mesmo número
  if (sock || conectando) return;
  conectando = true;
  status = 'iniciando';
  let auth: Awaited<ReturnType<typeof useMultiFileAuthState>>;
  let versao: Awaited<ReturnType<typeof fetchLatestBaileysVersion>>['version'] | undefined;
  try {
    auth = await useMultiFileAuthState(PASTA_SESSAO);
    // A versão do WhatsApp Web embutida na biblioteca envelhece e o servidor recusa sem mostrar QR
    versao = (await fetchLatestBaileysVersion().catch(() => null))?.version;
  } catch (erro) {
    status = 'desconectado';
    throw erro;
  } finally {
    conectando = false;
  }
  const { state, saveCreds } = auth;
  const atual = makeWASocket({
    auth: state,
    ...(versao ? { version: versao } : {}),
    logger: silencioso,
    browser: Browsers.ubuntu('Gestao'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = atual;
  atual.ev.on('creds.update', saveCreds);
  atual.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !aoReceber) return;
    for (const m of messages) {
      const recebida = lerMensagemRecebida(m);
      if (!recebida) continue;
      const { jid, destino, texto } = recebida;
      await aoReceber(jid, texto, async (resposta) => {
        // Pausa curta de pessoa digitando antes de responder
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
        await sock?.sendMessage(destino, { text: resposta });
      }).catch((erro) => console.error('[WHATSAPP] Falha ao tratar resposta:', erro instanceof Error ? erro.message : 'erro desconhecido'));
    }
  });
  atual.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (sock !== atual) return; // socket antigo, já trocado
    if (qr) {
      qrImagem = await QRCode.toDataURL(qr);
      status = 'aguardando_qr';
    }
    if (connection === 'open') {
      tentativasReconexao = 0;
      status = 'conectado';
      qrImagem = null;
      numero = atual.user?.id.split(':')[0].split('@')[0] ?? null;
      console.log('[WHATSAPP] Conectado por QR code.');
    }
    if (connection === 'close') {
      sock = null;
      if (codigoDesconexao(lastDisconnect?.error) === DisconnectReason.loggedOut) {
        // Desconectado pelo celular: apaga a sessão para gerar um QR novo na próxima vez
        status = 'desconectado';
        numero = null;
        await rm(PASTA_SESSAO, { recursive: true, force: true });
        console.log('[WHATSAPP] Sessão encerrada pelo celular.');
      } else {
        // Queda de rede ou reinício pedido pelo WhatsApp (comum logo após ler o QR): reconecta, esperando cada vez
        // mais; se o WhatsApp recusar sempre (ex.: versão antiga), desiste e a tela volta a oferecer o QR
        const espera = esperaReconexao(tentativasReconexao);
        tentativasReconexao += 1;
        if (espera === null) {
          status = 'desconectado';
          tentativasReconexao = 0;
          console.error('[WHATSAPP] Não foi possível reconectar; conecte de novo pela tela.');
          return;
        }
        status = 'iniciando';
        setTimeout(() => { void conectarWhatsappQr().catch(() => { status = 'desconectado'; }); }, espera);
      }
    }
  });
};

export const desconectarWhatsappQr = async () => {
  const atual = sock;
  sock = null;
  status = 'desconectado';
  qrImagem = null;
  numero = null;
  await atual?.logout().catch(() => atual.end(undefined));
  await rm(PASTA_SESSAO, { recursive: true, force: true });
};

/** Ao subir a API: reconecta sozinho se já havia um número conectado antes */
export const retomarWhatsappQr = async () => {
  const { state } = await useMultiFileAuthState(PASTA_SESSAO);
  if (state.creds.registered) await conectarWhatsappQr();
};

export const whatsappQr: WhatsappProvider = {
  get ativo() { return status === 'conectado'; },
  podeEnviar: () => status === 'conectado' && contador.restantes() > 0,
  recebeRespostas: true,
  enviar: async (telefone, mensagem) => {
    const espera = esperaAteProximo(ultimoEnvio, Date.now());
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    if (!sock || status !== 'conectado') throw new Error('WhatsApp desconectado.');
    if (contador.restantes() <= 0) throw new Error('Limite diário de mensagens atingido.');
    // Mandar para número sem WhatsApp é um dos sinais que mais levam a bloqueio
    const existe = (await sock.onWhatsApp(jidDoTelefone(telefone)))?.[0];
    ultimoEnvio = Date.now();
    if (!existe?.exists) throw new Error('Número sem WhatsApp.');
    await sock.sendMessage(existe.jid, { text: mensagem });
    contador.registrar();
  },
};
