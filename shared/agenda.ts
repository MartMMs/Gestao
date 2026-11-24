// datasBR importa daqui só a constante do fuso, e só dentro de funções: o ciclo entre os dois arquivos é seguro
import { formatarDataBR } from './datasBR';

/**
 * Regras de agenda compartilhadas entre backend (API interna e totem) e frontend.
 * Alterar aqui muda o comportamento dos dois lados ao mesmo tempo.
 */

export const FUSO_HORARIO = 'America/Sao_Paulo';
export const INTERVALO_AGENDAMENTO_MIN = 15;
export const INTERVALO_SLOT_TOTEM_MIN = 30;
export const DURACAO_PADRAO_MIN = 60;
// Turno usado quando um dia vira "trabalho" sem turno definido (ex.: troca de turno aprovada)
export const TURNO_PADRAO = '08:00-18:00';
export const TURNO_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export type ServicoComDuracao = { duracao?: number | null; tempoHigienizacaoMin?: number | null };

// Tempo que um serviço ocupa na agenda: atendimento + higienização da sala
export const duracaoServico = (servico?: ServicoComDuracao | null) =>
  (Number(servico?.duracao) || DURACAO_PADRAO_MIN) + (Number(servico?.tempoHigienizacaoMin) || 0);

export const duracaoTotal = (servicos: ServicoComDuracao[] = []) =>
  servicos.length > 0 ? servicos.reduce((total, servico) => total + duracaoServico(servico), 0) : DURACAO_PADRAO_MIN;

export const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HORARIO_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const horarioParaMinutos = (horario: string) => {
  const [h, m] = horario.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Horário de funcionamento da casa (ConfiguracaoEmpresa). `limite` = último horário em que um atendimento pode
 * começar (null = até o fechamento). `dias` = dias da semana abertos (0 = domingo ... 6 = sábado).
 */
export type Funcionamento = { abertura: string; fechamento: string; limite: string | null; dias: number[]; especiais: DiaEspecial[] };
/** Exceção de uma data (AAAA-MM-DD): fechada o dia todo, ou aberta com horário próprio (vale mesmo em dia da semana fechado). */
export type DiaEspecial = { data: string; fechado: boolean; abertura: string | null; fechamento: string | null; motivo: string | null };
export const FUNCIONAMENTO_PADRAO: Funcionamento = {
  abertura: '09:00', fechamento: '21:00', limite: null, dias: [0, 1, 2, 3, 4, 5, 6], especiais: [],
};
export const MAX_DIAS_ESPECIAIS = 120;
export const NOMES_DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// "aos domingos", "às segundas": o dia da semana no plural, para avisos de dia fechado
export const diaNoPlural = (semana: number) => `${semana === 0 || semana === 6 ? 'aos' : 'às'} ${NOMES_DIAS_SEMANA[semana]}s`;

// Lê da config da empresa (ou de dados ainda não carregados): campo ausente ou inválido vale o padrão
export const lerFuncionamento = (cfg?: {
  horaAbertura?: string | null; horaFechamento?: string | null; horaLimiteAgendamento?: string | null; diasFuncionamento?: number[] | null;
  diasEspeciais?: unknown;
} | null): Funcionamento => ({
  abertura: horarioValido(cfg?.horaAbertura) ? cfg.horaAbertura : FUNCIONAMENTO_PADRAO.abertura,
  fechamento: horarioValido(cfg?.horaFechamento) ? cfg.horaFechamento : FUNCIONAMENTO_PADRAO.fechamento,
  limite: horarioValido(cfg?.horaLimiteAgendamento) ? cfg.horaLimiteAgendamento : null,
  // Lista vazia ou com lixo (gravada direto no banco) fecharia a casa inteira: vale o padrão
  dias: diasValidos(cfg?.diasFuncionamento) ? cfg.diasFuncionamento : FUNCIONAMENTO_PADRAO.dias,
  // Item com lixo (gravado direto no banco) é ignorado: não pode fechar nem abrir a casa por engano
  especiais: Array.isArray(cfg?.diasEspeciais)
    ? (cfg.diasEspeciais as unknown[]).map(lerDiaEspecial).filter((d): d is DiaEspecial => d !== null && !erroDiaEspecial(d))
      .sort((a, b) => a.data.localeCompare(b.data))
    : [],
});

// Lê um dia especial vindo do banco ou do corpo da requisição (só os campos conhecidos); null se não for objeto
export const lerDiaEspecial = (bruto: unknown): DiaEspecial | null => {
  if (!bruto || typeof bruto !== 'object') return null;
  const d = bruto as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fechado = d.fechado === true;
  return {
    data: typeof d.data === 'string' ? d.data : '',
    fechado,
    abertura: fechado ? null : texto(d.abertura),
    fechamento: fechado ? null : texto(d.fechamento),
    motivo: texto(d.motivo)?.slice(0, 80) ?? null,
  };
};

// Confere um dia especial; retorna a mensagem de erro ou null
export const erroDiaEspecial = (d: DiaEspecial): string | null => {
  if (!dataValida(d.data)) return 'Escolha uma data válida para o dia especial.';
  if (d.fechado) return null;
  if (!horarioValido(d.abertura) || !horarioValido(d.fechamento)) return `Informe abertura e fechamento de ${formatarDataBR(d.data)} no formato HH:MM.`;
  const abre = horarioParaMinutos(d.abertura);
  if (horarioParaMinutos(d.fechamento) <= abre) return `Em ${formatarDataBR(d.data)}, o fechamento precisa ser depois da abertura.`;
  if (abre % INTERVALO_AGENDAMENTO_MIN !== 0) return `Em ${formatarDataBR(d.data)}, a abertura precisa ser de ${INTERVALO_AGENDAMENTO_MIN} em ${INTERVALO_AGENDAMENTO_MIN} minutos (ex.: 08:00, 08:15).`;
  return null;
};


/**
 * Horário que vale numa data: o dia especial dela, se houver, senão o horário da semana.
 * Dia especial aberto vale a abertura/fechamento dele (sem "último horário": até o fechamento).
 */
export const funcionamentoNaData = (f: Funcionamento, data: string): Funcionamento & { especial: DiaEspecial | null } => {
  const especial = f.especiais.find((d) => d.data === data) ?? null;
  if (!especial) return { ...f, especial: null };
  if (especial.fechado) return { ...f, dias: f.dias.filter((d) => d !== diaDaSemana(data)), especial };
  return { ...f, abertura: especial.abertura!, fechamento: especial.fechamento!, limite: null, dias: [0, 1, 2, 3, 4, 5, 6], especial };
};

// A casa abre nessa data (dia da semana aberto, sem dia especial fechado; ou dia especial aberto)
export const abreNaData = (f: Funcionamento, data: string) => funcionamentoNaData(f, data).dias.includes(diaDaSemana(data));

// "Fechado em 10/12/2026 (Inventário)." ou "A casa não abre aos domingos."
export const mensagemCasaFechada = (f: Funcionamento, data: string) => {
  const { especial } = funcionamentoNaData(f, data);
  return especial?.fechado
    ? `A casa estará fechada em ${formatarDataBR(data)}${especial.motivo ? ` (${especial.motivo})` : ''}.`
    : `A casa não abre ${diaNoPlural(diaDaSemana(data))}.`;
};

function diasValidos(dias: unknown): dias is number[] {
  return Array.isArray(dias) && dias.length > 0 && new Set(dias).size === dias.length
    && dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

// Confere o que o administrador ou o supervisor quer gravar. Retorna a mensagem de erro ou null
export const validarFuncionamento = (f: Funcionamento): string | null => {
  if (!f.abertura || !f.fechamento) return 'Preencha a abertura e o fechamento.';
  if (!horarioValido(f.abertura) || !horarioValido(f.fechamento)) return 'Informe abertura e fechamento no formato HH:MM.';
  const abre = horarioParaMinutos(f.abertura);
  const fecha = horarioParaMinutos(f.fechamento);
  if (fecha <= abre) return 'O fechamento precisa ser depois da abertura.';
  // Os horários da agenda andam de 15 em 15 min: abertura 09:10 nunca seria aceita (o primeiro início seria 09:15)
  if (abre % INTERVALO_AGENDAMENTO_MIN !== 0) return `A abertura precisa ser em hora cheia ou de ${INTERVALO_AGENDAMENTO_MIN} em ${INTERVALO_AGENDAMENTO_MIN} minutos (ex.: 08:00, 08:15, 08:30).`;
  if (f.limite !== null) {
    if (!horarioValido(f.limite)) return 'Informe o último horário de agendamento no formato HH:MM.';
    const limite = horarioParaMinutos(f.limite);
    if (limite < abre || limite >= fecha) return 'O último horário para agendar precisa ser a partir da abertura e antes do fechamento.';
    if (limite % INTERVALO_AGENDAMENTO_MIN !== 0) return `O último horário para agendar precisa ser de ${INTERVALO_AGENDAMENTO_MIN} em ${INTERVALO_AGENDAMENTO_MIN} minutos (ex.: 19:00, 19:15).`;
  }
  if (!Array.isArray(f.dias) || f.dias.length === 0) return 'Escolha pelo menos um dia de funcionamento.';
  if (!diasValidos(f.dias)) return 'Dias de funcionamento inválidos.';
  if (f.especiais.length > MAX_DIAS_ESPECIAIS) return `No máximo ${MAX_DIAS_ESPECIAIS} dias especiais.`;
  if (new Set(f.especiais.map((d) => d.data)).size !== f.especiais.length) return 'Há mais de um dia especial na mesma data.';
  for (const d of f.especiais) { const e = erroDiaEspecial(d); if (e) return e; }
  return null;
};

// Dia da semana de uma data AAAA-MM-DD (0 = domingo), sem depender do fuso de quem roda
export const diaDaSemana = (data: string) => {
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
};

// Folga gravada pelo BlockModal: o dia todo, independente do horário da casa (que pode mudar depois)
export const FOLGA_INICIO = '00:00';
export const FOLGA_FIM = '23:59';

// Bloqueio que cobre todo o expediente (da abertura ao fechamento): o profissional fica indisponível no dia
// O horário é obrigatório: sem ele valeria o padrão 09:00–21:00 calado, mesmo com a casa configurada de outro jeito
// Com a data do bloqueio, vale o horário daquele dia (dia especial das 10h às 14h: bloquear 10h–14h é o dia todo)
export const bloqueioDiaInteiro = (bloqueio: { horaInicio: string; horaFim: string; data?: string }, semanal: Funcionamento) => {
  const f = bloqueio.data ? funcionamentoNaData(semanal, bloqueio.data) : semanal;
  return horarioParaMinutos(bloqueio.horaInicio) <= horarioParaMinutos(f.abertura)
    && horarioParaMinutos(bloqueio.horaFim) >= horarioParaMinutos(f.fechamento);
};

// O minuto do dia cai dentro do bloqueio (início incluso, fim excluso)
export const minutoDentroDoBloqueio = (minuto: number, bloqueio: { horaInicio: string; horaFim: string }) =>
  minuto >= horarioParaMinutos(bloqueio.horaInicio) && minuto < horarioParaMinutos(bloqueio.horaFim);

export const minutosParaHorario = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

export const dataValida = (data: unknown): data is string => {
  if (typeof data !== 'string' || !DATA_REGEX.test(data)) return false;
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
};

export const horarioValido = (horario: unknown): horario is string =>
  typeof horario === 'string' && HORARIO_REGEX.test(horario);

// Data (YYYY-MM-DD) e minutos desde a meia-noite no fuso do negócio
export const partesNoFuso = (instante: Date) => {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_HORARIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante).map((p) => [p.type, p.value]));
  const horario = `${partes.hour}:${partes.minute}`;
  return { data: `${partes.year}-${partes.month}-${partes.day}`, horario, minutos: horarioParaMinutos(horario) };
};

// Converte data + horário locais (Brasília) para o instante UTC correspondente
export const instanteNoFuso = (data: string, horario: string): Date => {
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, m] = horario.split(':').map(Number);
  const palpite = Date.UTC(ano, mes - 1, dia, h, m);
  // Descobre o deslocamento do fuso naquele instante (sem horário de verão hoje, mas robusto se voltar)
  const local = partesNoFuso(new Date(palpite));
  const [la, lm, ld] = local.data.split('-').map(Number);
  const localComoUtc = Date.UTC(la, lm - 1, ld, Math.floor(local.minutos / 60), local.minutos % 60);
  return new Date(palpite + (palpite - localComoUtc));
};

/**
 * Valida início e duração de um agendamento. Retorna a mensagem de erro ou null.
 * `agora` permite recusar horários que já passaram.
 */
export const validarHorarioAgendamento = (
  data: string,
  horario: string,
  duracaoMin: number,
  { agora, intervaloMin = INTERVALO_AGENDAMENTO_MIN, funcionamento: semanal = FUNCIONAMENTO_PADRAO }: { agora?: Date; intervaloMin?: number; funcionamento?: Funcionamento } = {},
): string | null => {
  if (!dataValida(data) || !horarioValido(horario)) return 'Data ou horário inválido.';
  if (!Number.isFinite(duracaoMin) || duracaoMin <= 0) return 'Duração do atendimento inválida.';

  if (!abreNaData(semanal, data)) return mensagemCasaFechada(semanal, data);
  const f = funcionamentoNaData(semanal, data);
  const inicio = horarioParaMinutos(horario);
  const abre = horarioParaMinutos(f.abertura);
  const fecha = horarioParaMinutos(f.fechamento);
  // Com limite, ele é o último início aceito; sem limite, qualquer início antes do fechamento
  if (inicio < abre || (f.limite !== null ? inicio > horarioParaMinutos(f.limite) : inicio >= fecha)) {
    return f.limite !== null
      ? `Agendamentos só podem começar entre ${f.abertura} e ${f.limite}.`
      : `Agendamentos só podem começar entre ${f.abertura} e ${f.fechamento}.`;
  }
  if (inicio % intervaloMin !== 0) {
    return `Os horários devem ser múltiplos de ${intervaloMin} minutos (ex.: 10:00, ${minutosParaHorario(10 * 60 + intervaloMin)}).`;
  }
  if (inicio + duracaoMin > fecha) {
    return `Este agendamento termina depois do fechamento (${f.fechamento}). Escolha um horário mais cedo.`;
  }
  if (agora) {
    const atual = partesNoFuso(agora);
    if (data < atual.data || (data === atual.data && inicio < atual.minutos)) {
      return 'Não é possível agendar em um horário que já passou.';
    }
  }
  return null;
};

export const intervalosSobrepoem = (inicioA: number, fimA: number, inicioB: number, fimB: number) =>
  inicioA < fimB && inicioB < fimA;

// Datas para exibição: shared/datasBR.ts (formatarDataBR e afins)
