import { Request } from 'express';
import { getUsuario, usuarioEhSupervisor, usuarioGerenciaAgenda } from '../auth';
import { prisma } from '../db';
import { PAPEIS_ATENDIMENTO } from './usuarios';

// Origem gravada nos agendamentos criados pelo próprio colaborador
export const ORIGEM_COLABORADOR = 'colaborador';

/**
 * Regras de LGPD para respostas da API:
 * - supervisores e admins veem tudo;
 * - demais usuários veem CPF e telefone mascarados;
 * - dados de saúde (anamnese) só aparecem para o profissional do próprio atendimento.
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

export const prepararCliente = <T extends ClienteBase>(cliente: T, req: Request, podeVerSaude: boolean): T => {
  if (!cliente || usuarioEhSupervisor(req)) return cliente;
  return {
    ...cliente,
    cpf: mascararCpf(cliente.cpf),
    telefone: mascararTelefone(cliente.telefone),
    observacao: podeVerSaude ? cliente.observacao : null,
  };
};

// Motivo de bloqueio pode ser sensível (atestado, consulta): só a gestão e o próprio profissional o veem
export const prepararBloqueio = <T extends { colaboradorId: string; motivo?: string | null }>(bloqueio: T, req: Request): T =>
  usuarioGerenciaAgenda(req) || bloqueio.colaboradorId === getUsuario(req)?.id ? bloqueio : { ...bloqueio, motivo: 'Indisponível' };

type AgendamentoBase = { clienteId: string; observacoesSaude?: string | null; cliente?: ClienteBase | null };

// Janela em que um atendimento libera a ficha de saúde ao profissional
const ACESSO_ANTES_HORAS = 7 * 24; // atendimento marcado para os próximos 7 dias
const ACESSO_DEPOIS_DIAS = 30; // atendimento concluído nos últimos 30 dias

/**
 * Clientes cuja anamnese o profissional pode ver/editar. Regras:
 * - só profissionais que atendem (recepção não tem acesso à saúde);
 * - só atendimentos ativos e próximos (até 7 dias à frente) ou concluídos há até 30 dias:
 *   cancelado, falta ou atendimento antigo não dão acesso permanente;
 * - agendamentos que o próprio colaborador criou não liberam acesso
 *   (senão bastaria agendar qualquer cliente para si para ler a ficha de saúde dele).
 */
export const clientesComAcessoSaude = async (req: Request): Promise<Set<string>> => {
  const usuario = getUsuario(req);
  if (!usuario || usuarioEhSupervisor(req) || !PAPEIS_ATENDIMENTO.includes(usuario.papel)) return new Set();
  const agora = Date.now();
  const ags = await prisma.agendamento.findMany({
    where: {
      colaboradorId: usuario.id,
      NOT: { reservaOrigem: ORIGEM_COLABORADOR },
      OR: [
        { status: 'scheduled', data: { gte: new Date(agora - 12 * 3_600_000), lte: new Date(agora + ACESSO_ANTES_HORAS * 3_600_000) } },
        { status: 'completed', data: { gte: new Date(agora - ACESSO_DEPOIS_DIAS * 86_400_000) } },
      ],
    },
    select: { clienteId: true },
    distinct: ['clienteId'],
  });
  return new Set(ags.map((a) => a.clienteId));
};

export const prepararAgendamento = <T extends AgendamentoBase>(agendamento: T, req: Request, acessoSaude: Set<string>): T => {
  if (!agendamento || usuarioEhSupervisor(req)) return agendamento;
  const podeVerSaude = acessoSaude.has(agendamento.clienteId);
  return {
    ...agendamento,
    observacoesSaude: podeVerSaude ? agendamento.observacoesSaude : null,
    ...(agendamento.cliente ? { cliente: prepararCliente(agendamento.cliente, req, podeVerSaude) } : {}),
  };
};
