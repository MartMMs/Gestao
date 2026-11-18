import { normalizarTelefone } from './validadores';

// Mensagens de lembrete escritas pela casa, com chaves entre chaves: "Olá, {nome}! Seu horário é {horario}."
// Usado pela tela (destacar e explicar as chaves) e pelo servidor (trocar pelas informações do cliente).

export const VARIAVEIS_LEMBRETE = [
  { chave: 'nome', explicacao: 'Primeiro nome do cliente', exemplo: 'Maria' },
  { chave: 'data', explicacao: 'Dia do atendimento', exemplo: '11/12' },
  { chave: 'horario', explicacao: 'Hora do atendimento', exemplo: '10:30' },
  { chave: 'dia da semana', explicacao: 'Dia da semana do atendimento', exemplo: 'quinta-feira' },
  { chave: 'numero da reserva', explicacao: 'Código da reserva, para mostrar na recepção', exemplo: 'AG-1A2B3C' },
  { chave: 'nome da empresa', explicacao: 'Nome da casa, como está em Empresa & Segmento', exemplo: 'Spa Exemplo' },
  { chave: 'telefone da empresa', explicacao: 'Telefone de contato da casa', exemplo: '(11) 99999-8888' },
  { chave: 'endereco', explicacao: 'Endereço da casa', exemplo: 'Av. Principal, 1000' },
] as const;

export type DadosLembrete = Partial<Record<(typeof VARIAVEIS_LEMBRETE)[number]['chave'], string>>;

/** Lembrete quando a casa não escreveu nenhuma mensagem */
export const MENSAGEM_PADRAO = '*{nome da empresa}*\nOlá, {nome}! Lembrete do seu horário em {data} às {horario}. Se não puder vir, avise a recepção.';

export const MAX_MENSAGENS_LEMBRETE = 10;
export const MAX_TAMANHO_MENSAGEM = 1000;

// Aceita maiúsculas, acento e espaços sobrando: {Número da Reserva} = {numero da reserva}
const normalizar = (chave: string) => chave.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const CONHECIDAS = new Set<string>(VARIAVEIS_LEMBRETE.map((v) => v.chave));
const CHAVE_REGEX = /\{([^{}\n]{1,40})\}/g;

export type Trecho = { texto: string; tipo: 'texto' | 'chave' | 'desconhecida' };

/** Divide a mensagem em texto comum, chaves reconhecidas e chaves que não existem (para pintar na tela) */
export const trechosMensagem = (mensagem: string): Trecho[] => {
  const trechos: Trecho[] = [];
  let ultimo = 0;
  for (const m of mensagem.matchAll(CHAVE_REGEX)) {
    if (m.index > ultimo) trechos.push({ texto: mensagem.slice(ultimo, m.index), tipo: 'texto' });
    trechos.push({ texto: m[0], tipo: CONHECIDAS.has(normalizar(m[1])) ? 'chave' : 'desconhecida' });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < mensagem.length) trechos.push({ texto: mensagem.slice(ultimo), tipo: 'texto' });
  return trechos;
};

/** Troca as chaves pelas informações; chave sem informação vira vazio (nunca sai "{endereco}" para o cliente) */
export const preencherMensagem = (mensagem: string, dados: DadosLembrete) =>
  mensagem.replace(CHAVE_REGEX, (original, chave: string) => {
    const nome = normalizar(chave);
    return CONHECIDAS.has(nome) ? (dados[nome as keyof DadosLembrete] ?? '') : original;
  });

/** Erro para mostrar ao salvar, ou null */
export const validarMensagensLembrete = (mensagens: unknown): string | null => {
  if (!Array.isArray(mensagens) || mensagens.some((m) => typeof m !== 'string')) return 'Envie uma lista de mensagens.';
  if (mensagens.length > MAX_MENSAGENS_LEMBRETE) return `No máximo ${MAX_MENSAGENS_LEMBRETE} mensagens.`;
  for (const [i, m] of (mensagens as string[]).entries()) {
    if (!m.trim()) return `A mensagem ${i + 1} está vazia.`;
    if (m.length > MAX_TAMANHO_MENSAGEM) return `A mensagem ${i + 1} passa de ${MAX_TAMANHO_MENSAGEM} letras.`;
    const errada = trechosMensagem(m).find((t) => t.tipo === 'desconhecida');
    if (errada) return `A mensagem ${i + 1} tem a chave ${errada.texto}, que o sistema não conhece.`;
  }
  return null;
};

// Confirmação no lembrete. Pelo WhatsApp por QR code (não oficial) botões clicáveis não chegam de forma confiável,
// principalmente no iPhone: vai uma enquete de 1 clique (aparece em qualquer celular) e a resposta digitada 1/2 também vale
export const TITULO_CONFIRMACAO = 'Confirmação de Agendamento';
export const OPCAO_SIM = 'Sim, confirmo';
export const OPCAO_NAO = 'Não poderei ir';
export const TEXTO_CONFIRMACAO = `\n\n*${TITULO_CONFIRMACAO}*\nToque numa opção da enquete abaixo ou responda *1* (${OPCAO_SIM}) ou *2* (${OPCAO_NAO}).`;
export const RESPOSTA_SIM = 'Obrigado! Seu horário está confirmado. Até lá!';
export const RESPOSTA_NAO = 'Tudo bem, avisamos a equipe. Para remarcar, fale com a recepção.';

/** Resposta do cliente ao lembrete: 'sim', 'nao' ou null (qualquer outra mensagem é ignorada) */
export const interpretarResposta = (texto: unknown): 'sim' | 'nao' | null => {
  if (typeof texto !== 'string') return null;
  const t = normalizar(normalizar(texto).replace(/[^a-z0-9 ]/g, ' '));
  if (t === '1' || t === 'sim' || t.startsWith('sim ') || t.startsWith('confirmo')) return 'sim';
  if (t === '2' || t === 'nao' || t.startsWith('nao ') || t.startsWith('nao poderei')) return 'nao';
  return null;
};

/**
 * Telefone na forma usada para ligar a resposta ao lembrete: DDD + número, com o 9 dos celulares antigos (o WhatsApp
 * mostra "55 11 87654321" para quem tem "11 987654321"). Envio e resposta passam por aqui, para as chaves baterem
 */
export const telefoneParaResposta = (telefone: unknown) => {
  const d = normalizarTelefone(telefone);
  return d.length === 10 && /[6-9]/.test(d[2]) ? `${d.slice(0, 2)}9${d.slice(2)}` : d;
};

/** Número do WhatsApp (ex.: "5511987654321@s.whatsapp.net") no mesmo formato */
export const telefoneDoWhatsapp = (jid: string) => telefoneParaResposta(jid.split('@')[0].split(':')[0]);
