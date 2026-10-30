/**
 * utils/escalaCalculator.ts
 * Lógica de cálculo de escalas (6x1, 5x2, 12x36, rotativo)
 */

import { horarioParaMinutos } from './agenda';
import { ehFeriado, obterNomeFeriado } from './feriadosBR';

export type TipoEscala = '6x1' | '5x1' | '5x2' | '12x36' | 'rotativo' | 'personalizado';

export interface DiaEscala {
  data: string; // YYYY-MM-DD
  tipo: 'trabalho' | 'folga' | 'fds'; // fds = final de semana
  turno?: string;
  horaInicio?: string;
  horaFim?: string;
  descricao?: string;
  folgaDominicalConfigurada?: boolean;
  feriadoNome?: string;
}

export interface ConfiguracaoEscala {
  tipo: TipoEscala;
  dataInicio: string;
  cicloEmDias?: number; // para rotativo e personalizado
  turnosDisponiveis?: Array<{ nome: string; inicio: string; fim: string }>;
}

// Datas AAAA-MM-DD tratadas sempre em UTC ao meio-dia. new Date('AAAA-MM-DD') é meia-noite UTC, e ler o dia
// da semana no horário local (-03 no Brasil) trocava o domingo pela segunda e deslocava toda a escala.
const dataUTC = (data: string) => new Date(`${data.slice(0, 10)}T12:00:00Z`);

// Referência fixa dos ciclos que não seguem a semana (12x36 e 5x1). Contar a partir da data pedida fazia o ciclo
// recomeçar todo dia 1 e a API (que olha também a semana anterior) calcular uma malha diferente da tela.
const ANCORA_CICLO = new Date('2000-01-01T12:00:00Z');
const diasDesdeAncora = (data: Date) => Math.round((data.getTime() - ANCORA_CICLO.getTime()) / 86_400_000);
const posicaoNoCiclo = (data: Date, ciclo: number) => ((diasDesdeAncora(data) % ciclo) + ciclo) % ciclo;

/**
 * Gera escala 6x1 (6 dias trabalha, 1 folga): segunda a sábado, descanso no domingo.
 * Segue o dia da semana, não a posição desde o início: qualquer data inicial dá a mesma malha.
 */
export function gerarEscala6x1(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = dataUTC(dataInicio);

  for (let i = 0; i < numeroDias; i++) {
    const diaSemana = data.getUTCDay();
    const tipo = diaSemana === 0 ? 'fds' : 'trabalho';
    
    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'fds' ? 'Fim de Semana' : 'Trabalho',
    });
    
    data.setUTCDate(data.getUTCDate() + 1);
  }
  
  return resultado;
}

/**
 * Gera escala 5x2 (5 dias trabalha, 2 folgas consecutivas): segunda a sexta, folga sábado e domingo.
 */
export function gerarEscala5x2(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = dataUTC(dataInicio);

  for (let i = 0; i < numeroDias; i++) {
    const diaSemana = data.getUTCDay();
    const tipo = diaSemana === 0 || diaSemana === 6 ? 'folga' : 'trabalho';
    
    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'folga' ? 'Folga' : 'Trabalho',
    });
    
    data.setUTCDate(data.getUTCDate() + 1);
  }
  
  return resultado;
}

/**
 * Gera escala 5x1 (5 dias trabalha, 1 folga)
 */
export function gerarEscala5x1(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = dataUTC(dataInicio);
  const padrao = ['trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'folga'];

  for (let i = 0; i < numeroDias; i++) {
    const tipo = padrao[posicaoNoCiclo(data, 6)];

    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'folga' ? 'Folga' : 'Trabalho',
    });

    data.setUTCDate(data.getUTCDate() + 1);
  }

  return resultado;
}

/**
 * Gera escala 12x36: plantões de 12 horas com 36 horas de descanso, ou seja, um dia sim, um dia não, sempre no
 * mesmo turno (alternar noturno e diurno deixaria só 24h de descanso entre um plantão e outro).
 * O dia de plantão é ancorado numa data fixa: gerando mês a mês, o ciclo continua de um mês para o outro em vez
 * de recomeçar no dia 1 (31 e 1 seriam plantões seguidos, com 0h de descanso).
 */
export function gerarEscala12x36(
  dataInicio: string,
  numeroDias: number,
  turnos: { diurno: { inicio: string; fim: string }; noturno?: { inicio: string; fim: string } }
): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = dataUTC(dataInicio);
  const turno = turnos.diurno;

  for (let i = 0; i < numeroDias; i++) {
    if (posicaoNoCiclo(data, 2) === 0) {
      resultado.push({
        data: data.toISOString().split('T')[0],
        tipo: 'trabalho',
        turno: 'Diurno',
        horaInicio: turno.inicio,
        horaFim: turno.fim,
        descricao: '12h de trabalho',
      });
    } else {
      resultado.push({
        data: data.toISOString().split('T')[0],
        tipo: 'folga',
        descricao: 'Folga (36h)',
      });
    }

    data.setUTCDate(data.getUTCDate() + 1);
  }

  return resultado;
}

/**
 * Gera escala rotativa (3 ou 4 turnos rodando)
 * Semana 1: Turno 1 (07:00-15:00)
 * Semana 2: Turno 2 (15:00-23:00)
 * Semana 3: Turno 3 (23:00-07:00)
 * Semana 4: Folga
 */
export function gerarEscalaRotativa(
  dataInicio: string,
  numeroDias: number,
  turnos: Array<{ nome: string; inicio: string; fim: string }>
): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = dataUTC(dataInicio);

  for (let i = 0; i < numeroDias; i++) {
    // Muda de turno toda segunda-feira, contando semanas desde a âncora (2000-01-03 foi segunda)
    const semana = Math.floor((diasDesdeAncora(data) - 2) / 7);
    const turnoIndex = ((semana % turnos.length) + turnos.length) % turnos.length;
    const turnoConfig = turnos[turnoIndex];
    
    let tipo: 'trabalho' | 'folga' | 'fds' = 'trabalho';
    let dia: DiaEscala;
    
    if (turnoIndex === turnos.length - 1) {
      // Última semana = folga
      tipo = 'folga';
      dia = {
        data: data.toISOString().split('T')[0],
        tipo,
        descricao: 'Folga/Descanso',
      };
    } else {
      dia = {
        data: data.toISOString().split('T')[0],
        tipo,
        turno: turnoConfig.nome,
        horaInicio: turnoConfig.inicio,
        horaFim: turnoConfig.fim,
        descricao: turnoConfig.nome,
      };
    }
    
    resultado.push(dia);
    
    data.setUTCDate(data.getUTCDate() + 1);
  }
  
  return resultado;
}

/**
 * Função genérica para gerar escala
 */
export function gerarEscala(
  config: ConfiguracaoEscala,
  numeroDias: number
): DiaEscala[] {
  const { tipo, dataInicio } = config;
  
  switch (tipo) {
    case '6x1':
      return gerarEscala6x1(dataInicio, numeroDias);
    
    case '5x2':
      return gerarEscala5x2(dataInicio, numeroDias);

    case '5x1':
      return gerarEscala5x1(dataInicio, numeroDias);
    
    case '12x36':
      return gerarEscala12x36(dataInicio, numeroDias, {
        diurno: { inicio: '07:00', fim: '19:00' },
        noturno: { inicio: '19:00', fim: '07:00' },
      });
    
    case 'rotativo':
      return gerarEscalaRotativa(dataInicio, numeroDias, [
        { nome: 'Manhã', inicio: '07:00', fim: '15:00' },
        { nome: 'Tarde', inicio: '15:00', fim: '23:00' },
        { nome: 'Noite', inicio: '23:00', fim: '07:00' },
        { nome: 'Folga', inicio: '', fim: '' },
      ]);
    
    case 'personalizado':
    default:
      return [];
  }
}

const montarDescricaoFeriado = (descricaoAtual: string | undefined, nomeFeriado: string) => {
  const descricaoFeriado = `Feriado: ${nomeFeriado}`;
  if (!descricaoAtual) return descricaoFeriado;
  if (descricaoAtual.toLowerCase().includes('feriado')) return descricaoAtual;
  return `${descricaoAtual} • ${descricaoFeriado}`;
};

/**
 * Aplica feriados nacionais automaticamente na malha de escala.
 * Regra padrão: se o dia estava como trabalho, vira indisponível (tipo fds)
 * mantendo identificação de feriado para exibição na UI.
 */
export function aplicarFeriadosNaEscala(dias: DiaEscala[]): DiaEscala[] {
  return dias.map((dia) => {
    if (!ehFeriado(dia.data)) return dia;

    const nomeFeriado = obterNomeFeriado(dia.data) || 'Feriado nacional';
    const descricao = montarDescricaoFeriado(dia.descricao, nomeFeriado);

    if (dia.tipo === 'trabalho') {
      return {
        ...dia,
        tipo: 'fds',
        turno: undefined,
        horaInicio: undefined,
        horaFim: undefined,
        descricao,
        feriadoNome: nomeFeriado,
      };
    }

    return {
      ...dia,
      descricao,
      feriadoNome: nomeFeriado,
    };
  });
}

/**
 * Gera malha com regras automáticas do domínio:
 * 1) base por tipo de escala
 * 2) feriados nacionais
 * 3) folgas dominicais configuradas
 */
export function gerarEscalaComRegras(
  config: ConfiguracaoEscala,
  numeroDias: number,
  options?: { folgasDomingoNoMes?: number },
): DiaEscala[] {
  const diasBase = gerarEscala(config, numeroDias);
  const diasComFeriado = aplicarFeriadosNaEscala(diasBase);
  return aplicarFolgasDomingoNoMes(diasComFeriado, options?.folgasDomingoNoMes ?? 0);
}

/**
 * Garante quantidade minima de domingos de folga no mes.
 * Se o dia ja for folga/fds, apenas contabiliza; se nao for, converte para folga.
 */
export function aplicarFolgasDomingoNoMes(dias: DiaEscala[], folgasDomingoNoMes: number): DiaEscala[] {
  if (!Number.isFinite(folgasDomingoNoMes) || folgasDomingoNoMes <= 0) return dias;

  // Conta por mês do calendário: uma janela que atravessa a virada do mês (como a da API) dá o mesmo resultado
  const domingosDeFolga = new Map<string, number>();

  return dias.map((dia) => {
    const diaSemana = dataUTC(dia.data).getUTCDay();
    if (diaSemana !== 0) return dia;

    const mes = dia.data.slice(0, 7);
    const jaConcedidos = domingosDeFolga.get(mes) ?? 0;
    if (jaConcedidos < folgasDomingoNoMes) {
      domingosDeFolga.set(mes, jaConcedidos + 1);

      if (dia.tipo === 'folga' || dia.tipo === 'fds') {
        return {
          ...dia,
          folgaDominicalConfigurada: true,
          descricao: dia.descricao || (dia.feriadoNome ? `Feriado: ${dia.feriadoNome}` : 'Folga dominical'),
        };
      }

      return {
        ...dia,
        tipo: 'folga',
        turno: undefined,
        horaInicio: undefined,
        horaFim: undefined,
        descricao: dia.feriadoNome ? `Feriado: ${dia.feriadoNome}` : 'Folga dominical',
        folgaDominicalConfigurada: true,
      };
    }

    return dia;
  });
}

/**
 * Calcula total de horas em uma escala
 */
export function calcularHorasEscala(dias: DiaEscala[]): {
  horasTrabalhadas: number;
  diasFolga: number;
  diasTrabalho: number;
  percentualUtilizacao: number;
} {
  let horasTrabalhadas = 0;
  let diasFolga = 0;
  let diasTrabalho = 0;
  
  dias.forEach(dia => {
    if (dia.tipo === 'trabalho') {
      diasTrabalho++;
      if (dia.horaInicio && dia.horaFim) {
        let horas = (horarioParaMinutos(dia.horaFim) - horarioParaMinutos(dia.horaInicio)) / 60;
        
        // Considerar turno que passa da meia-noite
        if (horas < 0) horas += 24;
        
        horasTrabalhadas += horas;
      }
    } else if (dia.tipo === 'folga') {
      diasFolga++;
    }
  });
  
  const totalDias = dias.length;
  const percentualUtilizacao = totalDias > 0 ? (diasTrabalho / totalDias) * 100 : 0;
  
  return {
    horasTrabalhadas: Math.round(horasTrabalhadas * 10) / 10,
    diasFolga,
    diasTrabalho,
    percentualUtilizacao: Math.round(percentualUtilizacao),
  };
}

/**
 * Retorna próximo dia de folga
 */
export function proximaFolga(dias: DiaEscala[], dataReferencia: string): string | null {
  return dias.find(d => d.data >= dataReferencia && d.tipo === 'folga')?.data || null;
}

/**
 * Retorna próximo turno
 */
export function proximoTurno(dias: DiaEscala[], dataReferencia: string): DiaEscala | null {
  return dias.find(d => d.data >= dataReferencia && d.tipo === 'trabalho') || null;
}

// Turno "HH:MM-HH:MM" em início e fim (indefinidos quando o texto não tem esse formato)
export const separarTurno = (turno?: string | null) => {
  if (!turno || !turno.includes('-')) return { horaInicio: undefined as string | undefined, horaFim: undefined as string | undefined };
  const [horaInicio, horaFim] = turno.split('-');
  return { horaInicio: horaInicio || undefined, horaFim: horaFim || undefined };
};

// Hora (0-23) em que o turno "HH:MM-HH:MM" começa; null quando o turno não é legível (não vira 08:00 escondido)
export const horaInicialDoTurno = (turno?: string | null): number | null => {
  const { horaInicio } = separarTurno(turno);
  const minutos = horaInicio ? horarioParaMinutos(horaInicio) : NaN;
  return Number.isNaN(minutos) ? null : Math.floor(minutos / 60);
};

// Ajuste salvo para um dia (override): fonte única para o backend (alertas de CLT) e as telas
export type AjusteEscala = { tipo?: string | null; turno?: string | null; descricao?: string | null };

/**
 * Aplica o ajuste salvo sobre o dia calculado pelo contrato. Tipo desconhecido é ignorado; folga/fds limpa o
 * turno; dia de trabalho com turno "HH:MM-HH:MM" troca o horário. A descrição do ajuste prevalece quando existe.
 */
export function aplicarAjusteEscala(dia: DiaEscala, ajuste?: AjusteEscala | null): DiaEscala {
  if (!ajuste) return dia;
  const tipo = ajuste.tipo;
  if (tipo !== 'trabalho' && tipo !== 'folga' && tipo !== 'fds') return dia;
  const descricao = ajuste.descricao ?? dia.descricao;
  if (tipo !== 'trabalho') {
    return { ...dia, tipo, turno: undefined, horaInicio: undefined, horaFim: undefined, descricao };
  }
  const { horaInicio, horaFim } = separarTurno(ajuste.turno);
  return {
    ...dia,
    tipo: 'trabalho',
    turno: ajuste.turno || dia.turno,
    horaInicio: horaInicio || dia.horaInicio,
    horaFim: horaFim || dia.horaFim,
    descricao,
  };
}
