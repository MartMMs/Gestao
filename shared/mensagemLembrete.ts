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
