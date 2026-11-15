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
export type Funcionamento = { abertura: string; fechamento: string; limite: string | null; dias: number[] };
export const FUNCIONAMENTO_PADRAO: Funcionamento = {
  abertura: '09:00', fechamento: '21:00', limite: null, dias: [0, 1, 2, 3, 4, 5, 6],
};
export const NOMES_DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Lê da config da empresa (ou de dados ainda não carregados): campo ausente ou inválido vale o padrão
export const lerFuncionamento = (cfg?: {
  horaAbertura?: string | null; horaFechamento?: string | null; horaLimiteAgendamento?: string | null; diasFuncionamento?: number[] | null;
} | null): Funcionamento => ({
  abertura: horarioValido(cfg?.horaAbertura) ? cfg.horaAbertura : FUNCIONAMENTO_PADRAO.abertura,
  fechamento: horarioValido(cfg?.horaFechamento) ? cfg.horaFechamento : FUNCIONAMENTO_PADRAO.fechamento,
  limite: horarioValido(cfg?.horaLimiteAgendamento) ? cfg.horaLimiteAgendamento : null,
  // Lista vazia ou com lixo (gravada direto no banco) fecharia a casa inteira: vale o padrão
  dias: diasValidos(cfg?.diasFuncionamento) ? cfg.diasFuncionamento : FUNCIONAMENTO_PADRAO.dias,
});

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
export const bloqueioDiaInteiro = (bloqueio: { horaInicio: string; horaFim: string }, f: Funcionamento = FUNCIONAMENTO_PADRAO) =>
  horarioParaMinutos(bloqueio.horaInicio) <= horarioParaMinutos(f.abertura)
  && horarioParaMinutos(bloqueio.horaFim) >= horarioParaMinutos(f.fechamento);

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
  { agora, intervaloMin = INTERVALO_AGENDAMENTO_MIN, funcionamento: f = FUNCIONAMENTO_PADRAO }: { agora?: Date; intervaloMin?: number; funcionamento?: Funcionamento } = {},
): string | null => {
  if (!dataValida(data) || !horarioValido(horario)) return 'Data ou horário inválido.';
  if (!Number.isFinite(duracaoMin) || duracaoMin <= 0) return 'Duração do atendimento inválida.';

  const semana = diaDaSemana(data);
  if (!f.dias.includes(semana)) return `A casa não abre ${semana === 0 || semana === 6 ? 'aos' : 'às'} ${NOMES_DIAS_SEMANA[semana]}s.`;
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

/** AAAA-MM-DD → DD/MM/AAAA */
export const dataBR = (data: string) => data.split('-').reverse().join('/');
/** AAAA-MM-DD → DD/MM */
export const diaMesBR = (data: string) => data.slice(5, 10).split('-').reverse().join('/');
