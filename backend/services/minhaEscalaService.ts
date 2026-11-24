import type { DiaEscala } from '../../shared/escala';

// "Ver minha escala": a escala de UMA pessoa, sem alertas de CLT nem dados de colegas

export type TipoMeuDia = 'trabalho' | 'folga' | 'feriado' | 'ferias' | 'afastamento';
export type MeuDia = { data: string; tipo: TipoMeuDia; turno: string | null; turnoNome: string | null; descricao: string | null };
export type ResumoMinhaEscala = { hoje: MeuDia | null; amanha: MeuDia | null; proximaFolga: string | null; atualizadaEm: string | null };

export const tipoDoMeuDia = (dia: DiaEscala): TipoMeuDia => {
  if (dia.tipo === 'trabalho') return 'trabalho';
  if (dia.descricao?.startsWith('Férias')) return 'ferias';
  if (dia.descricao?.startsWith('Atestado') || dia.descricao?.startsWith('Afastamento')) return 'afastamento';
  return dia.feriadoNome ? 'feriado' : 'folga';
};

const somarDias = (data: string, dias: number) => new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** `dias` deve cobrir o mês pedido e de hoje em diante (para achar a próxima folga) */
export function montarMinhaEscala(
  dias: DiaEscala[],
  mes: string,
  hoje: string,
  nomesDeTurno: ReadonlyMap<string, string>,
  atualizadaEm: Date | null,
): { mes: string; resumo: ResumoMinhaEscala; dias: MeuDia[] } {
  const meus = dias.map((dia): MeuDia => {
    const tipo = tipoDoMeuDia(dia);
    const turno = tipo === 'trabalho' ? (dia.horaInicio && dia.horaFim ? `${dia.horaInicio}-${dia.horaFim}` : dia.turno || null) : null;
    // Motivo de ausência (atestado etc.) não vai para a tela: o tipo já diz o que a pessoa precisa saber
    const descricao = tipo === 'feriado' ? dia.feriadoNome ?? null : null;
    return { data: dia.data, tipo, turno, turnoNome: turno ? nomesDeTurno.get(turno) ?? null : null, descricao };
  });
  const porData = new Map(meus.map((d) => [d.data, d]));
  return {
    mes,
    resumo: {
      hoje: porData.get(hoje) ?? null,
      amanha: porData.get(somarDias(hoje, 1)) ?? null,
      proximaFolga: meus.find((d) => d.data > hoje && d.tipo === 'folga')?.data ?? null,
      atualizadaEm: atualizadaEm ? atualizadaEm.toISOString() : null,
    },
    dias: meus.filter((d) => d.data.startsWith(`${mes}-`)),
  };
}
