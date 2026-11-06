import { normalizarTexto } from '@shared/validadores';
import { MAX_LINHAS_IMPORTACAO } from '@shared/clientes';

export const TAMANHO_MAXIMO = 2 * 1024 * 1024; // 2 MB: sobra para 500 clientes
export type LinhaCliente = { nome?: string; telefone?: string; cpf?: string; email?: string };

// Extensão e tipo informado pelo navegador precisam combinar. CSV vem com tipos variados (e às vezes vazio) conforme o
// sistema; XLSX tem um só. O conteúdo é conferido depois (assinatura do arquivo)
const TIPOS: Record<'csv' | 'xlsx', string[]> = {
  csv: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'text/comma-separated-values', ''],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

export const tipoDaPlanilha = (arquivo: { name: string; type: string; size: number }): 'csv' | 'xlsx' => {
  const extensao = arquivo.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extensao !== 'csv' && extensao !== 'xlsx') throw new Error('Envie um arquivo .csv ou .xlsx.');
  if (!TIPOS[extensao].includes(arquivo.type)) throw new Error(`O arquivo diz ser .${extensao}, mas o tipo dele (${arquivo.type || 'desconhecido'}) não confere.`);
  if (arquivo.size === 0) throw new Error('O arquivo está vazio.');
  if (arquivo.size > TAMANHO_MAXIMO) throw new Error('Arquivo maior que 2 MB. Divida a planilha.');
  return extensao;
};

// Cabeçalhos aceitos (sem acento/caixa). Colunas desconhecidas são ignoradas
const COLUNAS: Record<string, keyof LinhaCliente> = {
  nome: 'nome', 'nome completo': 'nome', cliente: 'nome',
  telefone: 'telefone', celular: 'telefone', whatsapp: 'telefone', fone: 'telefone',
  cpf: 'cpf',
  email: 'email', 'e-mail': 'email',
};

// CSV (RFC 4180): aspas com "" escapado, quebras de linha dentro de aspas, separador ; (Excel em português) ou ,
export const lerCsv = (texto: string): string[][] => {
  let conteudo = texto.replace(/^\uFEFF/, '');
  // O Excel às vezes grava uma primeira linha "sep=;" dizendo o separador: vale ela, e a linha sai
  const declarado = conteudo.match(/^sep=(.)\r?\n/i);
  if (declarado) conteudo = conteudo.slice(declarado[0].length);
  const primeiraLinha = conteudo.split(/\r?\n/, 1)[0];
  const separador = declarado?.[1]
    ?? ((primeiraLinha.match(/;/g)?.length ?? 0) >= (primeiraLinha.match(/,/g)?.length ?? 0) ? ';' : ',');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let entreAspas = false;
  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];
    if (entreAspas) {
      if (c === '"' && conteudo[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') entreAspas = false;
      else campo += c;
    } else if (c === '"' && campo === '') entreAspas = true;
    else if (c === separador) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && conteudo[i + 1] === '\n') i += 1;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
};

// Primeira linha = cabeçalho. Linhas em branco no fim saem; no meio ficam (viram erro com o número certo da linha)
export const matrizParaClientes = (matriz: unknown[][]): LinhaCliente[] => {
  const [cabecalho = [], ...dados] = matriz;
  const campos = cabecalho.map((titulo) => COLUNAS[normalizarTexto(titulo)]);
  if (!campos.includes('nome')) throw new Error('A primeira linha precisa ter os títulos das colunas, com uma coluna "Nome" (e, se quiser, Telefone, CPF, E-mail).');
  const vazia = (linha: unknown[]) => linha.every((c) => c === null || c === undefined || String(c).trim() === '');
  while (dados.length && vazia(dados[dados.length - 1])) dados.pop();
  if (dados.length === 0) throw new Error('A planilha não tem clientes abaixo do cabeçalho.');
  if (dados.length > MAX_LINHAS_IMPORTACAO) throw new Error(`Máximo de ${MAX_LINHAS_IMPORTACAO} clientes por planilha (esta tem ${dados.length}). Divida o arquivo.`);

  return dados.map((linha) => {
    const cliente: LinhaCliente = {};
    campos.forEach((campo, i) => {
      if (!campo || linha[i] === null || linha[i] === undefined) return;
      let valor = String(linha[i]).trim();
      // CPF digitado como número no Excel perde o zero da frente
      if (campo === 'cpf' && /^\d{9,10}$/.test(valor)) valor = valor.padStart(11, '0');
      cliente[campo] = valor;
    });
    return cliente;
  });
};

// Assinatura real do conteúdo: XLSX é um ZIP (começa com "PK\x03\x04"); CSV é texto sem bytes nulos
const conferirConteudo = (bytes: Uint8Array, tipo: 'csv' | 'xlsx') => {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (tipo === 'xlsx' && !zip) throw new Error('O arquivo não é uma planilha .xlsx válida.');
  if (tipo === 'csv' && (zip || bytes.includes(0))) throw new Error('O arquivo não é um .csv de texto.');
};

export async function lerPlanilhaClientes(arquivo: File): Promise<LinhaCliente[]> {
  const tipo = tipoDaPlanilha(arquivo);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  conferirConteudo(bytes, tipo);
  if (tipo === 'csv') {
    let texto: string;
    try {
      texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // Excel antigo salva CSV em Windows-1252
      texto = new TextDecoder('windows-1252').decode(bytes);
    }
    return matrizParaClientes(lerCsv(texto));
  }
  return matrizParaClientes(await lerXlsxNoWorker(bytes.buffer));
}

const PRAZO_XLSX_MS = 15_000;
const ERRO_XLSX = 'Não foi possível ler a planilha .xlsx. Abra no Excel e salve de novo, ou exporte como .csv.';

// Worker carregado só aqui (a maioria das sessões nunca importa planilha), encerrado no prazo ou ao terminar
const lerXlsxNoWorker = (conteudo: ArrayBuffer) => new Promise<unknown[][]>((resolver, rejeitar) => {
  const worker = new Worker(new URL('./lerXlsx.worker.ts', import.meta.url), { type: 'module' });
  const encerrar = () => { clearTimeout(prazo); worker.terminate(); };
  const prazo = setTimeout(() => {
    encerrar();
    rejeitar(new Error('A planilha .xlsx demorou demais para abrir (arquivo muito grande ou corrompido). Exporte como .csv.'));
  }, PRAZO_XLSX_MS);
  worker.onmessage = (evento: MessageEvent<{ ok: boolean; matriz?: unknown[][] }>) => {
    encerrar();
    if (evento.data.ok && evento.data.matriz) resolver(evento.data.matriz);
    else rejeitar(new Error(ERRO_XLSX));
  };
  worker.onerror = () => { encerrar(); rejeitar(new Error(ERRO_XLSX)); };
  worker.postMessage(conteudo, [conteudo]);
});
