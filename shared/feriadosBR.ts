/**
 * Feriados nacionais brasileiros calculados para qualquer ano.
 * Datas móveis derivam da Páscoa (algoritmo de Meeus/Jones/Butcher).
 * Usado pelo backend (/api/feriados) e pelo frontend (escala).
 */

export interface Feriado {
  data: string; // YYYY-MM-DD
  nome: string;
  // 'facultativo': ponto facultativo nacional (Carnaval, Corpus Christi), tratado como feriado na escala
  tipo: 'nacional' | 'facultativo' | 'estadual' | 'municipal';
  uf?: string;
}

const FIXOS: Array<{ mes: number; dia: number; nome: string }> = [
  { mes: 1, dia: 1, nome: 'Ano Novo' },
  { mes: 4, dia: 21, nome: 'Tiradentes' },
  { mes: 5, dia: 1, nome: 'Dia do Trabalho' },
  { mes: 9, dia: 7, nome: 'Independência do Brasil' },
  { mes: 10, dia: 12, nome: 'Nossa Senhora Aparecida' },
  { mes: 11, dia: 2, nome: 'Finados' },
  { mes: 11, dia: 15, nome: 'Proclamação da República' },
  { mes: 11, dia: 20, nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
  { mes: 12, dia: 25, nome: 'Natal' },
];

const pad = (n: number) => String(n).padStart(2, '0');

// Trabalha só com datas UTC para não depender do fuso de quem executa
const toIso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const addDias = (date: Date, dias: number) => new Date(date.getTime() + dias * 86_400_000);

export function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const cache = new Map<number, Feriado[]>();

export function obterFeriadosNacionais(ano: number): Feriado[] {
  const emCache = cache.get(ano);
  if (emCache) return emCache;

  const pascoa = calcularPascoa(ano);
  const feriados: Feriado[] = [
    ...FIXOS.map(({ mes, dia, nome }) => ({ data: `${ano}-${pad(mes)}-${pad(dia)}`, nome, tipo: 'nacional' as const })),
    { data: toIso(addDias(pascoa, -48)), nome: 'Carnaval (segunda-feira)', tipo: 'facultativo' },
    { data: toIso(addDias(pascoa, -47)), nome: 'Carnaval', tipo: 'facultativo' },
    { data: toIso(addDias(pascoa, -2)), nome: 'Sexta-feira Santa', tipo: 'nacional' },
    { data: toIso(addDias(pascoa, 60)), nome: 'Corpus Christi', tipo: 'facultativo' },
  ];
  feriados.sort((x, y) => x.data.localeCompare(y.data));
  cache.set(ano, feriados);
  return feriados;
}

// Lê o ano direto da string para evitar o deslocamento de fuso de new Date('YYYY-MM-DD')
const anoDe = (data: string) => Number(data.slice(0, 4));

export function ehFeriado(data: string): boolean {
  return obterFeriadosNacionais(anoDe(data)).some((f) => f.data === data);
}

export function obterNomeFeriado(data: string): string | null {
  return obterFeriadosNacionais(anoDe(data)).find((f) => f.data === data)?.nome ?? null;
}

export function feriadosEntre(dataInicio: string, dataFim: string): Feriado[] {
  const resultado: Feriado[] = [];
  for (let ano = anoDe(dataInicio); ano <= anoDe(dataFim); ano++) {
    resultado.push(...obterFeriadosNacionais(ano).filter((f) => f.data >= dataInicio && f.data <= dataFim));
  }
  return resultado;
}

export function proximoFeriado(dataInicio: string): Feriado | null {
  const ano = anoDe(dataInicio);
  return [...obterFeriadosNacionais(ano), ...obterFeriadosNacionais(ano + 1)]
    .find((f) => f.data >= dataInicio) ?? null;
}

export function obterFeriadosMes(ano: number, mes: number): { [dia: number]: string } {
  const prefixo = `${ano}-${pad(mes)}-`;
  const resultado: { [dia: number]: string } = {};
  for (const f of obterFeriadosNacionais(ano)) {
    if (f.data.startsWith(prefixo)) resultado[Number(f.data.slice(8, 10))] = f.nome;
  }
  return resultado;
}
