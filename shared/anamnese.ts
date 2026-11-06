// Ficha de anamnese guardada na observação do cliente. Dois formatos:
// - interno (ficha da equipe): "<nota>\n__ANAMNESE_JSON__:{...}" com ao menos um campo preenchido;
// - totem: linha que começa com "[Anamnese Autoatendimento AAAA-MM-DD]: ..." (ver autoatendimentoService).
export const MARCADOR_ANAMNESE = '__ANAMNESE_JSON__:';
export const PREFIXO_TOTEM = '[Anamnese Autoatendimento ';

// Definição ÚNICA de linha para as regras abaixo: toda quebra (\r\n, \r, \v, \f, NEL, U+2028, U+2029) vira \n.
// Antes, uma regex com ^ multilinha via linha onde o split por \n não via, e a forja passava com \r ou U+2028
const QUEBRAS = /\r\n?|[\v\f\u0085\u2028\u2029]/g;
const linhas = (texto: unknown) => (typeof texto === 'string' ? texto.replace(QUEBRAS, '\n').split('\n') : []);
const linhasDoTotem = (texto: unknown) => linhas(texto).filter((l) => l.startsWith(PREFIXO_TOTEM));

// Campos de uma ficha interna com algum conteúdo (fonte única: a tela usa a mesma regra)
export const fichaPreenchida = (dados: unknown): boolean =>
  !!dados && typeof dados === 'object'
  && Object.values(dados).some((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== ''));

export const temFichaAnamnese = (observacao: unknown): boolean => {
  if (typeof observacao !== 'string') return false;
  if (contarFichasDoTotem(observacao) > 0) return true;
  const i = observacao.indexOf(MARCADOR_ANAMNESE);
  if (i < 0) return false;
  try {
    return fichaPreenchida(JSON.parse(observacao.slice(i + MARCADOR_ANAMNESE.length)));
  } catch {
    return false;
  }
};

export const contarFichasDoTotem = (texto: unknown) => linhasDoTotem(texto).length;

// Só o totem escreve a linha "[Anamnese Autoatendimento ...]" (é a declaração do próprio cliente). A equipe pode
// regravar a observação mantendo essas linhas idênticas ou tirando alguma; acrescentar ou alterar seria forjar a
// declaração. Conferir sempre o texto exato que vai ser gravado
export const forjaFichaDoTotem = (novo: unknown, atual: unknown) => {
  const gravadas = new Set(linhasDoTotem(atual));
  return linhasDoTotem(novo).some((linha) => !gravadas.has(linha));
};

export const MENSAGEM_ANAMNESE_OBRIGATORIA = 'A empresa exige ficha de anamnese: preencha a ficha do cliente antes de salvar.';
export const MENSAGEM_FICHA_TOTEM_RESERVADA = 'O texto "[Anamnese Autoatendimento ...]" é reservado à ficha que o cliente preenche no totem.';
export const CODIGO_ANAMNESE_OBRIGATORIA = 'ANAMNESE_OBRIGATORIA';
