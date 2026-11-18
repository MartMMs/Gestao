import { MOTIVOS_AUSENCIA, contaComoFolgaSemanal, ehAusencia, segundaDaSemana } from '@shared/escala';
import type { DiaEscala } from '../../../utils/escalaCalculator';

// Quem está de folga em cada dia de uma semana (segunda a domingo) e quais folgas podem ser trocadas

export type FolgaDaSemana = {
  colaboradorId: string;
  nome: string;
  data: string;
  rotulo: string;
  dia: DiaEscala;
  // Só a folga comum troca: feriado e ausência do RH (férias, atestado) têm motivo e não entram no rodízio
  trocavel: boolean;
  // Dias de trabalho da mesma pessoa na mesma semana, a partir de hoje: destinos possíveis da troca
  destinos: DiaEscala[];
};

const somarDias = (data: string, dias: number) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export const diasDaSemana = (qualquerDia: string) => {
  const segunda = segundaDaSemana(qualquerDia);
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
};

export const semanaVizinha = (qualquerDia: string, delta: number) => somarDias(segundaDaSemana(qualquerDia), delta * 7);

export const rotuloDaFolga = (dia: DiaEscala) => {
  if (dia.feriadoNome) return `Feriado (${dia.feriadoNome})`;
  if (ehAusencia(dia.descricao)) return MOTIVOS_AUSENCIA.find((m) => dia.descricao!.startsWith(m)) ?? 'Ausência';
  return dia.tipo === 'fds' ? 'FDS' : 'Folga';
};

export function folgasDaSemana(
  equipe: Array<{ id: string; name: string }>,
  escalaDe: (colaboradorId: string) => DiaEscala[],
  qualquerDia: string,
  hoje: string,
): Map<string, FolgaDaSemana[]> {
  const datas = diasDaSemana(qualquerDia);
  const porDia = new Map<string, FolgaDaSemana[]>(datas.map((d) => [d, []]));
  for (const pessoa of equipe) {
    const daSemana = escalaDe(pessoa.id).filter((d) => porDia.has(d.data));
    const destinos = daSemana.filter((d) => d.tipo === 'trabalho' && !d.feriadoNome && d.data >= hoje);
    for (const dia of daSemana) {
      if (dia.tipo === 'trabalho') continue;
      porDia.get(dia.data)!.push({
        colaboradorId: pessoa.id,
        nome: pessoa.name,
        data: dia.data,
        rotulo: rotuloDaFolga(dia),
        dia,
        trocavel: contaComoFolgaSemanal(dia) && dia.data >= hoje && destinos.length > 0,
        destinos,
      });
    }
  }
  for (const lista of porDia.values()) lista.sort((a, b) => a.nome.localeCompare(b.nome));
  return porDia;
}
