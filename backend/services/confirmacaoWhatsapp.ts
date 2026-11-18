// Resposta do cliente ao lembrete com confirmação (1 = Sim, 2 = Não). Puro: o banco, o Redis e o envio vêm de fora.
import { RESPOSTA_NAO, RESPOSTA_SIM, interpretarResposta } from '../../shared/mensagemLembrete';

/** Quanto tempo um número fica esperando resposta: mais que a janela de 24h do lembrete */
export const PRAZO_RESPOSTA_SEGUNDOS = 2 * 86_400;
export const chaveConfirmacao = (telefone: string) => `wa-confirmacao:${telefone}`;

export const tratarRespostaLembrete = async (deps: {
  telefone: string;
  texto: unknown;
  agendamentoPendente: (telefone: string) => Promise<string | null>;
  esquecer: (telefone: string) => Promise<void>;
  // Marca "Cliente não pode comparecer"; false se o agendamento não está mais marcado (cancelado, concluído...)
  marcarAusencia: (agendamentoId: string) => Promise<boolean>;
  responder: (texto: string) => Promise<void>;
  // Chegou 1/2 sem lembrete pendente para o número (registrar no log: indica chave que não bateu)
  semPendencia?: () => void;
}): Promise<'sim' | 'nao' | null> => {
  const resposta = interpretarResposta(deps.texto);
  // Mensagem que não é 1/2 não recebe resposta automática: conversa normal fica para a recepção (e não gera spam)
  if (!resposta) return null;
  const agendamentoId = await deps.agendamentoPendente(deps.telefone);
  if (!agendamentoId) {
    deps.semPendencia?.();
    return null;
  }
  await deps.esquecer(deps.telefone);
  if (resposta === 'nao' && !(await deps.marcarAusencia(agendamentoId))) return null;
  await deps.responder(resposta === 'sim' ? RESPOSTA_SIM : RESPOSTA_NAO);
  return resposta;
};
