// WhatsApp por QR code (WhatsApp Web, via Baileys), só para os lembretes de 24h. Não é a API oficial: o número pode
// ser bloqueado se mandar muito. Por isso: no máximo LIMITE_POR_DIA mensagens, uma pausa aleatória entre elas, só
// para quem tem WhatsApp, e nada de responder ou ficar "online". Trocar pela API oficial = outro WhatsappProvider.
// shortcut: sessão em arquivo no servidor e uma instância só; com várias instâncias da API, só uma deve conectar.

import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import makeWASocket, { Browsers, DisconnectReason, decryptPollVote, fetchLatestBaileysVersion, getKeyAuthor, jidNormalizedUser, useMultiFileAuthState, type WASocket } from 'baileys';
import QRCode from 'qrcode';
import { normalizarTelefone } from '../../shared/validadores';
import { diaISODe as diaBR } from '../../shared/datasBR';
import type { WhatsappProvider } from './whatsapp';
import { redisService } from './redisService';
import { mascararTelefone } from '../lib/privacidade';
import { telefoneDoWhatsapp } from '../../shared/mensagemLembrete';

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

type MensagemBaileys = {
  key: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; senderPn?: string | null; participant?: string | null };
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    buttonsResponseMessage?: { selectedButtonId?: string | null } | null;
    templateButtonReplyMessage?: { selectedId?: string | null } | null;
    interactiveResponseMessage?: { nativeFlowResponseMessage?: { paramsJson?: string | null } | null } | null;
    pollUpdateMessage?: { pollCreationMessageKey?: { id?: string | null } | null; vote?: { encPayload?: Uint8Array | null; encIv?: Uint8Array | null } | null } | null;
  } | null;
};

/** Ids dos botões de resposta (se algum aparelho devolver clique de botão): viram a mesma resposta do texto */
const RESPOSTA_DO_BOTAO: Record<string, string> = { confirmar_sim: '1', confirmar_nao: '2' };

export type MensagemRecebida = {
  // Para onde responder (o mesmo chat)
  destino: string;
  // Número de verdade, se já veio na mensagem (chat normal ou senderPn); null = conta "@lid" sem número: buscar no mapa
  jid: string | null;
  lid: string | null;
  texto: string | null;
  enquete: { pollId: string; vote: { encPayload: Uint8Array; encIv: Uint8Array } } | null;
};

/**
 * O que chegou numa conversa individual de outra pessoa: texto, clique de botão ou voto da enquete. Contas novas do
 * WhatsApp chegam com o chat em "@lid"; o número vem em senderPn quando o WhatsApp manda (nem sempre manda)
 */
export const lerMensagemRecebida = (m: MensagemBaileys): MensagemRecebida | null => {
  const destino = m.key.remoteJid;
  if (!destino || m.key.fromMe) return null;
  const ehLid = destino.endsWith('@lid');
  if (!ehLid && !destino.endsWith('@s.whatsapp.net')) return null; // grupos, status, canais
  const jid = ehLid ? (m.key.senderPn?.endsWith('@s.whatsapp.net') ? m.key.senderPn : null) : destino;
  const msg = m.message;
  let botao = msg?.buttonsResponseMessage?.selectedButtonId ?? msg?.templateButtonReplyMessage?.selectedId ?? null;
  const params = msg?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!botao && params) {
    try { botao = (JSON.parse(params) as { id?: string }).id ?? null; } catch { /* clique ilegível: ignora */ }
  }
  const texto = (botao && RESPOSTA_DO_BOTAO[botao]) ?? msg?.conversation ?? msg?.extendedTextMessage?.text ?? null;
  const voto = msg?.pollUpdateMessage;
  const enquete = voto?.pollCreationMessageKey?.id && voto.vote?.encPayload && voto.vote.encIv
    ? { pollId: voto.pollCreationMessageKey.id, vote: { encPayload: voto.vote.encPayload, encIv: voto.vote.encIv } }
    : null;
  if (!texto && !enquete) return null;
  return { destino, jid, lid: ehLid ? destino : null, texto: texto || null, enquete };
};

/** Opção escolhida na enquete: os votos vêm como sha256 do texto da opção */
export const opcaoVotada = (selecionadas: Uint8Array[], opcoes: string[]): number | null => {
  for (const sel of selecionadas) {
    const hex = Buffer.from(sel).toString('hex');
    const i = opcoes.findIndex((o) => createHash('sha256').update(o).digest('hex') === hex);
    if (i >= 0) return i;
  }
  return null;
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
const PRAZO_MAPA_SEGUNDOS = 3 * 86_400;
const chaveLid = (lid: string) => `wa-lid:${lid.split('@')[0].split(':')[0]}`;
const chaveEnquete = (id: string) => `wa-enquete:${id}`;
type EnqueteGuardada = { segredo: string; jid: string; opcoes: string[] };
const log = (texto: string) => console.log(`[WhatsApp Webhook] ${texto}`);
const mascarar = (jid: string | null) => (jid ? mascararTelefone(telefoneDoWhatsapp(jid)) ?? '?' : 'desconhecido');
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
  // Ligado a cada socket novo: depois de reconectar, o socket novo recebe o mesmo tratamento
  atual.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !aoReceber) return;
    for (const m of messages) {
      const recebida = lerMensagemRecebida(m as MensagemBaileys);
      if (!recebida) continue;
      try {
        // "@lid" sem número: usa o mapa gravado quando o lembrete foi enviado para esse contato
        const jid = recebida.jid ?? (recebida.lid ? await redisService.get(chaveLid(recebida.lid)) : null);
        let texto = recebida.texto;
        if (recebida.enquete) texto = await lerVoto(atual, m as MensagemBaileys, recebida.enquete, jid);
        log(`Mensagem recebida de ${mascarar(jid)}${recebida.lid ? ' (conta @lid)' : ''} | Texto extraído: ${texto ? JSON.stringify(texto.slice(0, 40)) : '(nenhum)'}`);
        if (!jid) { log('Sem número do remetente (conta @lid sem lembrete enviado por este servidor): ignorada.'); continue; }
        if (!texto) continue;
        await aoReceber(jid, texto, async (resposta) => {
          // Pausa curta de pessoa digitando antes de responder
          await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
          await sock?.sendMessage(recebida.destino, { text: resposta });
        });
      } catch (erro) {
        console.error('[WhatsApp Webhook] Falha ao tratar resposta:', erro instanceof Error ? erro.message : 'erro desconhecido');
      }
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

// Baileys 6.7.23 não decodifica votos sozinho (o trecho dele está desligado): o segredo da enquete foi guardado no envio
export async function lerVoto(atual: Pick<WASocket, 'user'>, m: MensagemBaileys, enquete: NonNullable<MensagemRecebida['enquete']>, jid: string | null): Promise<string | null> {
  const bruto = await redisService.get(chaveEnquete(enquete.pollId));
  if (!bruto) { log(`Voto numa enquete desconhecida (${enquete.pollId}): ignorado.`); return null; }
  const guardada = JSON.parse(bruto) as EnqueteGuardada;
  const eu = [atual.user?.id, (atual.user as { lid?: string } | undefined)?.lid].filter(Boolean).map((j) => jidNormalizedUser(j!));
  // Quem vota pode estar identificado pelo número ou pelo @lid: tenta as combinações até a chave abrir
  const votantes = [...new Set([getKeyAuthor(m.key as never, eu[0]), m.key.senderPn, jid, guardada.jid].filter(Boolean) as string[])];
  for (const criador of eu) {
    for (const votante of votantes) {
      try {
        const voto = decryptPollVote(enquete.vote, { pollEncKey: Buffer.from(guardada.segredo, 'base64'), pollCreatorJid: criador, pollMsgId: enquete.pollId, voterJid: votante });
        const i = opcaoVotada(voto.selectedOptions ?? [], guardada.opcoes);
        return i === null ? null : String(i + 1);
      } catch { /* combinação errada: tenta a próxima */ }
    }
  }
  log('Não foi possível ler o voto da enquete.');
  return null;
}

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
    if (typeof existe.lid === 'string' && existe.lid) await redisService.set(chaveLid(existe.lid), existe.jid, PRAZO_MAPA_SEGUNDOS);
  },
  // Enquete de 1 clique logo depois do lembrete (aparece em qualquer Android/iPhone, ao contrário de botões fora da API oficial)
  enviarEnquete: async (telefone, titulo, opcoes) => {
    if (!sock || status !== 'conectado') throw new Error('WhatsApp desconectado.');
    const jid = jidDoTelefone(telefone);
    const existe = (await sock.onWhatsApp(jid))?.[0];
    if (!existe?.exists) throw new Error('Número sem WhatsApp.');
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
    const enviada = await sock.sendMessage(existe.jid, { poll: { name: titulo, values: opcoes, selectableCount: 1 } });
    const segredo = enviada?.message?.messageContextInfo?.messageSecret;
    if (!enviada?.key.id || !segredo) throw new Error('Enquete enviada sem chave para ler o voto.');
    const guardada: EnqueteGuardada = { segredo: Buffer.from(segredo).toString('base64'), jid: existe.jid, opcoes };
    await redisService.set(chaveEnquete(enviada.key.id), JSON.stringify(guardada), PRAZO_MAPA_SEGUNDOS);
    log(`Enquete de confirmação enviada para ${mascarar(existe.jid)}.`);
  },
};
