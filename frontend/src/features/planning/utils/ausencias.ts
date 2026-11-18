import { ehAusencia } from '@shared/escala';

// Férias, atestado e afastamento do RH ficam gravados como folga com o motivo na descrição (um ajuste por dia)

export type AjusteDia = { colaboradorId: string; data: string; tipo: string; descricao?: string | null };
export type PeriodoAusencia = { id: string; nome: string; motivo: string; inicio: string; fim: string };

export const diasEntre = (inicio: string, fim: string) => {
  const datas: string[] = [];
  for (const d = new Date(`${inicio}T12:00:00Z`); d.toISOString().slice(0, 10) <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
    datas.push(d.toISOString().slice(0, 10));
  }
  return datas;
};

/** Dias seguidos com o mesmo motivo viram um período só; mais recentes primeiro */
export const periodosDeAusencia = (ajustes: Iterable<AjusteDia>, nomes: ReadonlyMap<string, string>): PeriodoAusencia[] => {
  const dias = [...ajustes]
    .filter((a) => a.tipo === 'folga' && ehAusencia(a.descricao) && nomes.has(a.colaboradorId))
    .sort((a, b) => a.colaboradorId.localeCompare(b.colaboradorId) || a.data.localeCompare(b.data));
  const lista: PeriodoAusencia[] = [];
  for (const dia of dias) {
    const ultimo = lista[lista.length - 1];
    if (ultimo && ultimo.id === dia.colaboradorId && ultimo.motivo === dia.descricao && diasEntre(ultimo.fim, dia.data).length === 2) {
      ultimo.fim = dia.data;
    } else {
      lista.push({ id: dia.colaboradorId, nome: nomes.get(dia.colaboradorId) || '', motivo: dia.descricao || '', inicio: dia.data, fim: dia.data });
    }
  }
  return lista.sort((a, b) => b.inicio.localeCompare(a.inicio));
};
