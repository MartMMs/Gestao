import type { ScaleOverridePayload } from '../../../api';
import { gerarEscalaComRegras, type DiaEscala } from '../../../utils/escalaCalculator';
import { turnoDoDia } from './turnos';
import { CARGA_SEMANAL_MAXIMA_HORAS, analisarInterjornadaEscala, analisarSetimoDiaConsecutivo, horasDoDia, horasPorSemana, inicioDaSemana } from '../../../utils/cltValidator';

// Modelos rápidos da Grade de Escalas. Devolvem só os dias que mudam; quem chama propõe e o supervisor confirma

// Ciclo de cada escala em dias (a rotativa roda 4 semanas)
const CICLO_DIAS: Record<string, number> = { '6x1': 7, '5x2': 7, '5x1': 6, '12x36': 2, rotativo: 28 };

const mudou = (atual: DiaEscala, proposto: DiaEscala) =>
  atual.tipo !== proposto.tipo || (proposto.tipo === 'trabalho' && turnoDoDia(atual) !== turnoDoDia(proposto));

const comoAjuste = (colaboradorId: string, data: string, dia: DiaEscala, descricao: string): ScaleOverridePayload => ({
  colaboradorId,
  data,
  tipo: dia.tipo,
  turno: dia.tipo === 'trabalho' ? turnoDoDia(dia) : undefined,
  descricao,
});

/**
 * Repete o mês anterior (já com os ajustes salvos) andando um múltiplo do ciclo da escala, para a folga cair no mesmo
 * ponto do ciclo (copiar por dia da semana quebrava a 12x36 e a 5x1). Feriado do mês atual continua feriado.
 */
export function repetirMesAnterior(
  colaboradorId: string,
  anterior: DiaEscala[],
  atual: DiaEscala[],
  tipoEscala?: string,
): ScaleOverridePayload[] {
  const ciclo = CICLO_DIAS[tipoEscala || '6x1'] ?? 7;
  const passo = ciclo * Math.floor(28 / ciclo); // 28 (ou 24 na 5x1): sempre cabe no mês anterior
  const repetido: DiaEscala[] = [];
  atual.forEach((dia, indice) => {
    const origem = indice >= passo ? repetido[indice - passo] : anterior[anterior.length - passo + indice];
    // Feriado não se repete: nem o de lá (vira dia comum) nem o daqui (continua feriado)
    const origemFeriado = origem?.feriadoNome && origem.tipo !== 'trabalho';
    repetido.push(!origem || origemFeriado || dia.feriadoNome ? dia : { ...origem, data: dia.data, feriadoNome: undefined });
  });
  return atual.flatMap((dia, indice) =>
    mudou(dia, repetido[indice]) ? [comoAjuste(colaboradorId, dia.data, repetido[indice], 'Repetido do mês anterior')] : []);
}

/**
 * Plantões 12x36 no mês, no mesmo ciclo da escala 12x36 do sistema (continua de um mês para o outro). Sem folga
 * dominical forçada: na 12x36 o descanso já vem do ciclo.
 */
export function preencher12x36(colaboradorId: string, atual: DiaEscala[]): ScaleOverridePayload[] {
  if (atual.length === 0) return [];
  const plantoes = gerarEscalaComRegras({ tipo: '12x36', dataInicio: atual[0].data }, atual.length);
  return atual.flatMap((dia, indice) => {
    const plantao = plantoes[indice];
    if (!plantao || !mudou(dia, plantao)) return [];
    return [comoAjuste(colaboradorId, dia.data, plantao, plantao.tipo === 'trabalho' ? 'Plantão 12x36' : 'Descanso 12x36')];
  });
}


// Primeiro dia do mês que precisa virar folga: quebra de interjornada, 7º dia seguido ou semana acima de 44h
function proximaViolacao(escala: DiaEscala[], prefixoMes: string, tipoEscala?: string): string | null {
  const interjornada = analisarInterjornadaEscala(escala).violacoes.find((v) => v.dataTurnoAtual.startsWith(prefixoMes));
  if (interjornada) return interjornada.dataTurnoAtual;
  const setimo = analisarSetimoDiaConsecutivo(escala).violacoes.find((v) => v.data.startsWith(prefixoMes));
  if (setimo) return setimo.data;
  if (tipoEscala === '12x36') return null; // 12x36 é medida pela média (art. 59-A): tirar um plantão não é a correção certa
  const porSemana = horasPorSemana(escala);
  const ultimoDaSemanaEstourada = escala
    .filter((dia) => dia.data.startsWith(prefixoMes) && horasDoDia(dia) > 0 && (porSemana.get(inicioDaSemana(dia.data)) ?? 0) > CARGA_SEMANAL_MAXIMA_HORAS)
    .map((dia) => dia.data)
    .sort()
    .pop();
  return ultimoDaSemanaEstourada ?? null;
}

/**
 * "Propor folgas na grade" do painel de conformidade: põe folga no dia de cada violação da CLT do mês, uma por vez, até a
 * escala (com os meses vizinhos) ficar conforme. Devolve só os dias que mudam; o supervisor confirma a proposta.
 */
export function corrigirViolacoesClt(colaboradorId: string, escala: DiaEscala[], prefixoMes: string, tipoEscala?: string): ScaleOverridePayload[] {
  let atual = escala;
  const folgas = new Set<string>();
  for (let passo = 0; passo < 31; passo += 1) {
    const data = proximaViolacao(atual, prefixoMes, tipoEscala);
    if (!data || folgas.has(data)) break;
    folgas.add(data);
    atual = atual.map((dia) => (dia.data === data ? { ...dia, tipo: 'folga', turno: undefined, horaInicio: undefined, horaFim: undefined } : dia));
  }
  return [...folgas].sort().map((data) => ({ colaboradorId, data, tipo: 'folga', descricao: 'Correção CLT sugerida' }));
}
