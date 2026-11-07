import { Request } from 'express';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda } from '../auth';
import { prisma } from '../db';
import { PAPEIS_ATENDIMENTO } from './usuarios';

// Origem gravada nos agendamentos criados pelo próprio colaborador
export const ORIGEM_COLABORADOR = 'colaborador';
// Reserva feita no totem público; vira ORIGEM_TOTEM_CHECKIN quando a recepção confirma a chegada do cliente
export const ORIGEM_TOTEM = 'autoatendimento';
export const ORIGEM_TOTEM_CHECKIN = 'autoatendimento_checkin';

/**
 * Regras de LGPD para respostas da API:
 * - supervisores e admins veem tudo;
 * - recepção vê o telefone completo (para ligar/confirmar com o cliente), mas CPF e e-mail mascarados;
 * - colaboradores veem CPF e telefone mascarados;
 * - dados de saúde (anamnese) só aparecem em tela para a supervisão e para o profissional do atendimento.
 */

export const mascararCpf = (cpf?: string | null) => {
  if (!cpf) return cpf;
  const digitos = String(cpf).replace(/\D/g, '');
  // Só os 2 últimos dígitos: com o meio e os verificadores à mostra o CPF ficava fácil de adivinhar
  if (digitos.length !== 11) return '***.***.***-**';
  return `***.***.***-${digitos.slice(9)}`;
};

export const mascararTelefone = (telefone?: string | null) => {
  if (!telefone) return telefone;
  const digitos = String(telefone).replace(/\D/g, '');
  if (digitos.length < 8) return '(**) *****-****';
  return `(**) *****-**${digitos.slice(-2)}`;
};

type ClienteBase = { id: string; cpf?: string | null; telefone?: string | null; observacao?: string | null };

export const prepararCliente = <T extends ClienteBase>(cliente: T, req: Request, veSaude: boolean): T => {
  if (!cliente || usuarioEhSupervisor(req)) return cliente;
  // A recepção precisa do telefone completo para ligar/confirmar caso o cliente atrase ou não compareça
  const veTelefone = usuarioGerenciaAgenda(req);
  return {
    ...cliente,
    cpf: mascararCpf(cliente.cpf),
    telefone: veTelefone ? cliente.telefone : mascararTelefone(cliente.telefone),
    // E-mail não tem máscara útil: só a supervisão vê
    ...('email' in cliente ? { email: null } : {}),
    observacao: veSaude ? cliente.observacao : null,
  };
};

// Motivo de bloqueio pode ser sensível (atestado, consulta): só a gestão e o próprio profissional o veem
export const prepararBloqueio = <T extends { colaboradorId: string; motivo?: string | null }>(bloqueio: T, req: Request): T =>
  usuarioGerenciaAgenda(req) || bloqueio.colaboradorId === getUsuario(req)?.id ? bloqueio : { ...bloqueio, motivo: 'Indisponível' };

type AgendamentoBase = {
  clienteId: string;
  colaboradorId?: string | null;
  observacoesSaude?: string | null;
  valorComissao?: unknown;
  cliente?: ClienteBase | null;
  servicos?: { comissaoPercentual?: number | null }[];
};

// Janela em que um atendimento libera a ficha de saúde ao profissional
const ACESSO_ANTES_HORAS = 7 * 24; // atendimento marcado para os próximos 7 dias
const ACESSO_DEPOIS_DIAS = 30; // atendimento concluído nos últimos 30 dias

/**
 * Clientes cuja anamnese o profissional pode ver/editar. Regras:
 * - só profissionais que atendem (recepção não vê o histórico de saúde em tela);
 * - só atendimentos ativos e próximos (até 7 dias à frente) ou concluídos há até 30 dias
 *   (inclusive quando o próprio profissional criou o agendamento para executar o serviço);
 * - reserva do totem ainda sem check-in na recepção não libera acesso.
 */
export const clientesComAcessoSaude = async (req: Request): Promise<Set<string>> => {
  const usuario = getUsuario(req);
  if (!usuario || usuarioEhSupervisor(req) || !PAPEIS_ATENDIMENTO.includes(usuario.papel)) return new Set();
  const agora = Date.now();
  const ags = await prisma.agendamento.findMany({
    where: {
      colaboradorId: usuario.id,
      // Reserva do totem só libera a ficha depois do check-in na recepção: qualquer pessoa com nome, telefone e CPF
      // de alguém consegue reservar ali (inclusive o próprio profissional, escolhendo a si mesmo)
      AND: [
        { OR: [{ reservaOrigem: null }, { reservaOrigem: { not: ORIGEM_TOTEM } }] },
        {
          OR: [
            { status: 'scheduled', data: { gte: new Date(agora - 12 * 3_600_000), lte: new Date(agora + ACESSO_ANTES_HORAS * 3_600_000) } },
            { status: 'completed', data: { gte: new Date(agora - ACESSO_DEPOIS_DIAS * 86_400_000) } },
          ],
        },
      ],
    },
    select: { clienteId: true },
    distinct: ['clienteId'],
  });
  return new Set(ags.map((a) => a.clienteId));
};

// Quem vê e altera a ficha de saúde (e as observações) de um cliente: a supervisão, ou quem tem acesso a ele agora
export const podeVerSaude = (req: Request, clienteId: string, acessoSaude: Set<string>) =>
  usuarioEhSupervisor(req) || acessoSaude.has(clienteId);

export const prepararAgendamento = <T extends AgendamentoBase>(agendamento: T, req: Request, acessoSaude: Set<string>): T => {
  if (!agendamento || usuarioEhSupervisor(req)) return agendamento;
  const veSaude = podeVerSaude(req, agendamento.clienteId, acessoSaude);
  // Comissão é dado financeiro da supervisão: cada profissional vê só a dos próprios atendimentos
  const podeVerComissao = !!agendamento.colaboradorId && agendamento.colaboradorId === getUsuario(req)?.id;
  return {
    ...agendamento,
    ...('valorComissao' in agendamento && !podeVerComissao ? { valorComissao: null } : {}),
    // O percentual junto com o valor do atendimento daria a comissão que acabou de ser escondida
    ...(agendamento.servicos ? { servicos: agendamento.servicos.map(({ comissaoPercentual: _comissao, ...s }) => s) } : {}),
    observacoesSaude: veSaude ? agendamento.observacoesSaude : null,
    // A tela trava o campo em vez de mostrá-lo vazio e editável (o servidor recusa texto novo; vazio é ignorado)
    observacoesSaudeOculta: !veSaude,
    ...(agendamento.cliente ? { cliente: prepararCliente(agendamento.cliente, req, veSaude) } : {}),
  };
};
