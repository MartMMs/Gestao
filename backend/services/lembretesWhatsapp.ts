// Job dos lembretes de 24h e respostas 1/2 do WhatsApp: liga as regras puras (whatsapp.ts, confirmacaoWhatsapp.ts)
// ao banco, ao Redis e aos avisos em tempo real. O server.ts só agenda o job e liga as respostas.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { Eventos } from '../lib/eventos';
import { ESCOPOS } from '../../shared/escopos';
import { diaMesDe, horaDe } from '../../shared/datasBR';
import { telefoneDoWhatsapp, telefoneParaResposta } from '../../shared/mensagemLembrete';
import { variantesTelefone } from '../../shared/validadores';
import { redactSensitiveData } from '../../shared/redact';
import { mascararTelefone } from '../lib/privacidade';
import { getEmpresaConfig } from './configService';
import { redisService } from './redisService';
import { LIMITE_LEMBRETES_POR_RODADA, enviarLembretes, filtroLembretes, type WhatsappProvider } from './whatsapp';
import { PRAZO_RESPOSTA_SEGUNDOS, chaveConfirmacao, tratarRespostaLembrete } from './confirmacaoWhatsapp';

/**
 * "2" só marca o agendamento ainda marcado, sem aviso anterior, e cujo cliente ainda tem este telefone e não pediu
 * para sair dos lembretes: se o telefone mudou ou o agendamento passou para outra pessoa depois do lembrete, quem
 * ficou com o número antigo não mexe nele
 */
export const filtroMarcarAusencia = (agendamentoId: string, telefone: string): Prisma.AgendamentoWhereInput => ({
  id: agendamentoId,
  status: 'scheduled',
  clienteAvisouAusenciaEm: null,
  cliente: { removidoEm: null, naoReceberWhatsapp: false, telefone: { in: variantesTelefone(telefone) } },
});

const chaveDoCliente = (telefone: string | null) => chaveConfirmacao(telefoneParaResposta(telefone));
const mensagemDoErro = (erro: unknown) => (erro instanceof Error ? erro.message : 'erro desconhecido');

/** Uma rodada do job (a cada 10 min). Uma por vez: o QR code pausa até 90 s entre envios e a rodada pode passar do intervalo */
export const criarJobLembretes = (escolherProvider: () => WhatsappProvider) => {
  let rodando = false;
  return async () => {
    const provider = escolherProvider();
    if (rodando || !provider.ativo) return;
    rodando = true;
    try {
      const empresa = await getEmpresaConfig();
      const enviados = await enviarLembretes({
        provider,
        empresa: {
          nome: empresa.nomeEmpresa, telefone: empresa.telefoneContato, endereco: empresa.endereco,
          mensagens: empresa.mensagensLembrete, pedeConfirmacao: empresa.lembretePedeConfirmacao,
        },
        agora: new Date(),
        buscar: async (de, ate) => (await prisma.agendamento.findMany({
          where: filtroLembretes(de, ate),
          select: { id: true, data: true, cliente: { select: { nome: true, telefone: true } } },
          orderBy: { data: 'asc' },
          take: LIMITE_LEMBRETES_POR_RODADA,
        })).map((ag) => ({ id: ag.id, data: ag.data, clienteNome: ag.cliente.nome, clienteTelefone: ag.cliente.telefone })),
        // Marca antes de enviar: na falha, não repete (melhor perder um lembrete que mandar vários). Dura mais que a janela
        marcarUmaVez: (id) => redisService.acquireLock(`lembrete-24h:${id}`, 2 * 86_400, '1'),
        registrarFalha: (id, erro) => console.error(`[WHATSAPP] Lembrete do agendamento ${id} não enviado:`, mensagemDoErro(erro)),
        podePerguntar: async (ag) => !(await redisService.get(chaveDoCliente(ag.clienteTelefone))),
        aoEnviar: async (ag, perguntou) => {
          if (perguntou) await redisService.set(chaveDoCliente(ag.clienteTelefone), ag.id, PRAZO_RESPOSTA_SEGUNDOS);
        },
      });
      if (enviados > 0) console.log(`[WHATSAPP] ${enviados} lembrete(s) enviado(s).`);
    } catch (error) {
      console.error('🚨 Erro nos lembretes por WhatsApp:', redactSensitiveData(error));
    } finally {
      rodando = false;
    }
  };
};

/** Resposta do cliente ao lembrete: "Não" marca o agendamento e avisa recepção, supervisão e o profissional */
export const tratarMensagemRecebida = (eventos: Eventos) => async (jid: string, texto: string, responder: (texto: string) => Promise<void>) => {
  const telefone = telefoneDoWhatsapp(jid);
  await tratarRespostaLembrete({
    telefone,
    texto,
    responder,
    agendamentoPendente: (tel) => redisService.get(chaveConfirmacao(tel)),
    esquecer: async (tel) => { await redisService.deleteKey(chaveConfirmacao(tel)); },
    semPendencia: () => console.log(`[WHATSAPP] Resposta 1/2 de ${mascararTelefone(telefone)} sem lembrete pendente (ignorada).`),
    marcarAusencia: async (agendamentoId) => {
      // Grava e lê juntos: o aviso sai com os dados do mesmo agendamento que foi marcado
      const ag = await prisma.$transaction(async (tx) => {
        const { count } = await tx.agendamento.updateMany({ where: filtroMarcarAusencia(agendamentoId, telefone), data: { clienteAvisouAusenciaEm: new Date() } });
        return count === 0 ? null : tx.agendamento.findUnique({ where: { id: agendamentoId }, select: { data: true, colaboradorId: true, cliente: { select: { nome: true } } } });
      });
      if (!ag) return false;
      eventos.notificarMudanca(ESCOPOS.agenda);
      eventos.avisarAusencia({ agendamentoId, cliente: ag.cliente.nome, data: diaMesDe(ag.data), horario: horaDe(ag.data), colaboradorId: ag.colaboradorId });
      return true;
    },
  });
};
