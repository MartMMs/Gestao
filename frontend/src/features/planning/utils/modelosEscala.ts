import type { ScaleOverridePayload } from '../../../api';
import { gerarEscalaComRegras, type DiaEscala } from '../../../utils/escalaCalculator';
import { turnoDoDia } from './turnos';

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
