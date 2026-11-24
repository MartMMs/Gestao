import { gerarEscalaComRegras, ehAusencia, type TipoEscala } from '../../shared/escala';

// Geração da escala de UM mês gravada dia a dia (snapshot): outros meses não mudam quando o turno muda depois

export type DiaGravado = { tipo: 'trabalho' | 'folga' | 'fds'; turno: string | null; descricao: string | null };
export type AjusteExistente = { data: string; tipo: string | null; descricao: string | null };

export function planejarMesGerado(opcoes: {
  tipoEscala: TipoEscala;
  folgasDomingoNoMes: number;
  mes: string; // AAAA-MM
  turno: string;
  hoje: string; // AAAA-MM-DD
  existentes: AjusteExistente[];
}): Array<{ data: string; dia: DiaGravado }> {
  const [ano, m] = opcoes.mes.split('-').map(Number);
  // Mesma janela da tela (desde o dia 1 do mês anterior): as folgas de domingo saem iguais às calculadas lá
  const inicio = new Date(Date.UTC(ano, m - 2, 1)).toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
  const total = Math.round((Date.parse(fim) - Date.parse(inicio)) / 86_400_000) + 1;
  const porData = new Map(opcoes.existentes.map((e) => [e.data, e]));
  return gerarEscalaComRegras({ tipo: opcoes.tipoEscala, dataInicio: inicio }, total, {
    folgasDomingoNoMes: opcoes.folgasDomingoNoMes,
    turnoPadrao: opcoes.turno,
  })
    .filter((dia) => dia.data.startsWith(opcoes.mes))
    .filter((dia) => {
      const atual = porData.get(dia.data);
      if (atual && ehAusencia(atual.descricao)) return false; // férias/atestado/afastamento ficam
      return !(atual && dia.data < opcoes.hoje); // dia passado já ajustado é registro do que aconteceu
    })
    .map((dia) => ({
      data: dia.data,
      dia: { tipo: dia.tipo, turno: dia.tipo === 'trabalho' ? dia.turno ?? opcoes.turno : null, descricao: null },
    }));
}
