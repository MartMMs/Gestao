/**
 * utils/escalaCalculator.ts
 * Lógica de cálculo de escalas (6x1, 5x2, 12x36, rotativo)
 */

import { ehFeriado, obterNomeFeriado } from '@shared/feriadosBR';

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

/**
 * Gera escala 6x1 (6 dias trabalha, 1 folga)
 * Seg Ter Qua Qui Sex Sáb | Dom(folga)
 */
export function gerarEscala6x1(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = new Date(dataInicio);
  const padrao = ['trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'folga'];
  
  for (let i = 0; i < numeroDias; i++) {
    const diaSemana = data.getDay();
    const tipo = diaSemana === 0 ? 'fds' : padrao[i % 7];
    
    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'folga' ? 'Folga' : tipo === 'fds' ? 'Fim de Semana' : 'Trabalho',
    });
    
    data.setDate(data.getDate() + 1);
  }
  
  return resultado;
}

/**
 * Gera escala 5x2 (5 dias trabalha, 2 folgas consecutivas)
 * Seg Ter Qua Qui Sex | Sáb Dom(folgas)
 */
export function gerarEscala5x2(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = new Date(dataInicio);
  const padrao = ['trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'folga', 'folga'];
  
  for (let i = 0; i < numeroDias; i++) {
    const diaSemana = data.getDay();
    const tipo = padrao[i % 7];
    
    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'folga' ? 'Folga' : 'Trabalho',
    });
    
    data.setDate(data.getDate() + 1);
  }
  
  return resultado;
}

/**
 * Gera escala 5x1 (5 dias trabalha, 1 folga)
 */
export function gerarEscala5x1(dataInicio: string, numeroDias: number): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = new Date(dataInicio);
  const padrao = ['trabalho', 'trabalho', 'trabalho', 'trabalho', 'trabalho', 'folga'];

  for (let i = 0; i < numeroDias; i++) {
    const tipo = padrao[i % 6];

    resultado.push({
      data: data.toISOString().split('T')[0],
      tipo: tipo as 'trabalho' | 'folga' | 'fds',
      descricao: tipo === 'folga' ? 'Folga' : 'Trabalho',
    });

    data.setDate(data.getDate() + 1);
  }

  return resultado;
}

/**
 * Gera escala 12x36 (12 horas trabalha, 36h folga)
 * 1 dia trabalha (12h) + 3 dias folga
 */
export function gerarEscala12x36(
  dataInicio: string,
  numeroDias: number,
  turnos: { diurno: { inicio: string; fim: string }; noturno: { inicio: string; fim: string } }
): DiaEscala[] {
  const resultado: DiaEscala[] = [];
  let data = new Date(dataInicio);
  let contadorCiclo = 0;
  
  for (let i = 0; i < numeroDias; i++) {
    const posicaoCiclo = contadorCiclo % 4; // 4 dias = 1 dia trabalho + 3 folga
    
    if (posicaoCiclo === 0) {
      // Dia de trabalho: alterna entre turno diurno e noturno
      const turnoAtual = i % 2 === 0 ? turnos.diurno : turnos.noturno;
      resultado.push({
        data: data.toISOString().split('T')[0],
        tipo: 'trabalho',
        turno: i % 2 === 0 ? 'Diurno' : 'Noturno',
        horaInicio: turnoAtual.inicio,
        horaFim: turnoAtual.fim,
        descricao: '12h de trabalho',
      });
    } else {
      // 3 dias de folga
      resultado.push({
        data: data.toISOString().split('T')[0],
        tipo: 'folga',
        descricao: 'Folga (36h)',
      });
    }
    
    data.setDate(data.getDate() + 1);
    contadorCiclo++;
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
  let data = new Date(dataInicio);
  let semanaAtual = 1;
  let turnoAtual = 0;
  let diasSemana = 0;
  
  for (let i = 0; i < numeroDias; i++) {
    const diaSemana = data.getDay();
    
    // Muda de turno a cada 7 dias (segunda-feira)
    if (diaSemana === 1 && diasSemana > 0) {
      turnoAtual++;
      diasSemana = 0;
    }
    
    const turnoIndex = (turnoAtual) % turnos.length;
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
    
    data.setDate(data.getDate() + 1);
    diasSemana++;
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

  let domingosDeFolga = 0;

  return dias.map((dia) => {
    const diaSemana = new Date(`${dia.data}T12:00:00`).getDay();
    if (diaSemana !== 0) return dia;

    if (domingosDeFolga < folgasDomingoNoMes) {
      domingosDeFolga++;

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
        const [h1, m1] = dia.horaInicio.split(':').map(Number);
        const [h2, m2] = dia.horaFim.split(':').map(Number);
        let horas = (h2 + m2 / 60) - (h1 + m1 / 60);
        
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
