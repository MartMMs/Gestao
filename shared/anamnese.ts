// Ficha de anamnese guardada na observação do cliente. Dois formatos:
// - interno (ficha da equipe): "<nota>\n__ANAMNESE_JSON__:{...}" com ao menos um campo preenchido;
// - totem: linha que começa com "[Anamnese Autoatendimento AAAA-MM-DD]: ..." (ver autoatendimentoService).
export const MARCADOR_ANAMNESE = '__ANAMNESE_JSON__:';
export const PREFIXO_TOTEM = '[Anamnese Autoatendimento ';

// Definição ÚNICA de linha para as regras abaixo: toda quebra (\r\n, \r, \v, \f, NEL, U+2028, U+2029) vira \n.
// Antes, uma regex com ^ multilinha via linha onde o split por \n não via, e a forja passava com \r ou U+2028
const QUEBRAS = /\r\n?|[\v\f\u0085\u2028\u2029]/g;
const linhas = (texto: unknown) => (typeof texto === 'string' ? texto.replace(QUEBRAS, '\n').split('\n') : []);
export const linhasDoTotem = (texto: unknown) => linhas(texto).filter((l) => l.startsWith(PREFIXO_TOTEM));

// Campos de uma ficha interna com algum conteúdo (fonte única: a tela usa a mesma regra)
export const CAMPOS_TEXTO_ANAMNESE = [
  'profissao', 'queixa', 'proteses', 'cirurgia', 'gravida', 'procedimentoEstetico',
  'marcapasso', 'outrosMedicamentos', 'lentesContato', 'alergia', 'patologia',
  'partesNaoTocadas', 'preferencia', 'pressao', 'banho', 'aromaterapia',
] as const;
export const CAMPOS_LISTA_ANAMNESE = ['caracteristicas', 'medicamentos'] as const;

const CHAVES_TEXTO = new Set<string>(CAMPOS_TEXTO_ANAMNESE);
const CHAVES_LISTA = new Set<string>(CAMPOS_LISTA_ANAMNESE);

export const valorPreenchido = (v: unknown) => (
  Array.isArray(v)
    ? v.some((item) => typeof item === 'string' && item.trim() !== '')
    : (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).trim() !== ''
);

export const fichaPreenchida = (dados: unknown): boolean => {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return false;
  const registro = dados as Record<string, unknown>;
  // Campos de lista não podem vir como número/objeto (quebraria o formulário ao abrir a ficha)
  for (const chave of CAMPOS_LISTA_ANAMNESE) {
    const lista = registro[chave];
    if (lista !== undefined && (!Array.isArray(lista) || !lista.every((item) => typeof item === 'string'))) return false;
  }
  for (const chave of CAMPOS_TEXTO_ANAMNESE) {
    const v = registro[chave];
    if (v !== undefined && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return false;
  }
  return Object.entries(registro).some(([k, v]) => (
    (CHAVES_LISTA.has(k) && Array.isArray(v) && valorPreenchido(v))
    || (CHAVES_TEXTO.has(k) && valorPreenchido(v))
  ));
};

// Substitui apenas o bloco __ANAMNESE_JSON__ preservando a nota clínica e as declarações do totem que já existiam
export const atualizarSomenteFichaJson = (observacaoAtual: string | null | undefined, fichaEnviada: unknown): string | null => {
  if (typeof fichaEnviada !== 'string') return null;
  const nova = separarFicha(fichaEnviada);
  if (!nova?.dados || !fichaPreenchida(nova.dados)) return null;
  const atual = observacaoAtual ?? '';
  const existente = separarFicha(atual);
  const nota = existente?.dados ? existente.nota : aparaObservacao(atual);
  const linhaJson = `${MARCADOR_ANAMNESE}${nova.json}`;
  return nota ? `${nota}\n${linhaJson}` : linhaJson;
};

// Apara a observação para gravar: só linhas em branco no começo e espaços no fim. Nunca o espaço no começo de uma
// linha: "  [Anamnese ..." sem ele viraria linha do totem e a gravação seria recusada como forja (400)
export const aparaObservacao = (texto: string) => texto.replace(/^(?:[ \t]*(?:\r\n?|\n))+/, '').trimEnd();

/**
 * Separa a ficha interna do resto da observação (regra ÚNICA da API e da tela). O texto não é alterado (só as
 * quebras de linha da nota viram \n; linhasDoTotem/forja já as normalizam):
 * - o marcador só vale no COMEÇO de uma linha separada por \r ou \n, que é onde a tela sempre o grava. No meio de
 *   uma linha (texto do cliente no totem, mesmo depois de um NEL ou U+2028; dentro de um campo da ficha) é texto;
 * - a ficha é o resto dessa linha (JSON.stringify escapa \r e \n; U+2028/U+2029/NEL podem estar num campo);
 * - vale a ÚLTIMA linha de ficha com JSON válido: regravar põe a ficha nova por último e ela vence. Fichas antigas
 *   ou quebradas ficam como texto da nota (tirá-las do texto remontava marcador e alterava linha do totem);
 * - cada linha é lida uma vez: custo linear no tamanho do texto.
 * dados = null: há marcador, mas nenhuma linha de ficha válida (a nota é o texto inteiro).
 */
export const separarFicha = (observacao: string): { nota: string; json: string; dados: Record<string, unknown> | null } | null => {
  if (!observacao.includes(MARCADOR_ANAMNESE)) return null;
  const linhasDoTexto = observacao.split(/\r\n?|\n/);
  for (let n = linhasDoTexto.length - 1; n >= 0; n -= 1) {
    if (!linhasDoTexto[n].startsWith(MARCADOR_ANAMNESE)) continue;
    const json = linhasDoTexto[n].slice(MARCADOR_ANAMNESE.length);
    let dados: unknown;
    try {
      dados = JSON.parse(json);
    } catch {
      continue;
    }
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) continue;
    const antes = linhasDoTexto.slice(0, n).join('\n').trimEnd();
    const depois = linhasDoTexto.slice(n + 1).join('\n').replace(/^\n+/, '').trimEnd();
    return { nota: [antes, depois].filter(Boolean).join('\n'), json: json.trim(), dados: dados as Record<string, unknown> };
  }
  return { nota: observacao.trimEnd(), json: '', dados: null };
};

export const temFichaAnamnese = (observacao: unknown): boolean => {
  if (typeof observacao !== 'string') return false;
  if (contarFichasDoTotem(observacao) > 0) return true;
  return fichaPreenchida(separarFicha(observacao)?.dados);
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
