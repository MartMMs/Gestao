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
  cliente: { removidoEm: null, naoReceberWhatsapp: false, telefone: { in: telefonesDoCliente(telefone) } },
});

/**
 * Como o telefone do cliente pode estar gravado: com e sem máscara/DDI e, nos celulares, com e sem o 9 depois do DDD
 * (cadastros antigos e o WhatsApp de celulares antigos usam os 8 dígitos)
 */
export const telefonesDoCliente = (telefone: string) => {
  const com9 = telefoneParaResposta(telefone);
  const sem9 = com9.length === 11 && com9[2] === '9' ? `${com9.slice(0, 2)}${com9.slice(3)}` : null;
  return [...new Set([...variantesTelefone(com9), ...(sem9 ? variantesTelefone(sem9) : [])])];
};

const chaveDoCliente = (telefone: string | null) => chaveConfirmacao(telefoneParaResposta(telefone));
const mensagemDoErro = (erro: unknown) => (erro instanceof Error ? erro.message : 'erro desconhecido');

/** Uma rodada do job (a cada 10 min). Uma por vez: o QR code pausa até 90 s entre envios e a rodada pode passar do intervalo */
export const criarJobLembretes = (escolherProvider: () => WhatsappProvider) => {
  let rodando = false;
  return async () => {
    const provider = escolherProvider();
    if (rodando) { console.log('[WHATSAPP] Rodada de lembretes: a anterior ainda está enviando; pulada.'); return; }
    if (!provider.ativo) { console.log('[WHATSAPP] Rodada de lembretes: WhatsApp não conectado (QR) e webhook desligado; nada enviado.'); return; }
    rodando = true;
    let naJanela = 0;
    let jaAvisados = 0;
    try {
      const empresa = await getEmpresaConfig();
      const enviados = await enviarLembretes({
        provider,
        empresa: {
          nome: empresa.nomeEmpresa, telefone: empresa.telefoneContato, endereco: empresa.endereco,
          mensagens: empresa.mensagensLembrete, pedeConfirmacao: empresa.lembretePedeConfirmacao,
        },
        agora: new Date(),
        buscar: async (de, ate) => { const lista = (await prisma.agendamento.findMany({
          where: filtroLembretes(de, ate),
          select: { id: true, data: true, cliente: { select: { nome: true, telefone: true } } },
          orderBy: { data: 'asc' },
          take: LIMITE_LEMBRETES_POR_RODADA,
        })).map((ag) => ({ id: ag.id, data: ag.data, clienteNome: ag.cliente.nome, clienteTelefone: ag.cliente.telefone }));
          naJanela = lista.length;
          return lista; },
        // Marca antes de enviar: na falha, não repete (melhor perder um lembrete que mandar vários). Dura mais que a janela
        marcarUmaVez: async (id) => { const primeira = await redisService.acquireLock(`lembrete-24h:${id}`, 2 * 86_400, '1'); if (!primeira) jaAvisados += 1; return primeira; },
        registrarFalha: (id, erro) => console.error(`[WHATSAPP] Lembrete do agendamento ${id} não enviado:`, mensagemDoErro(erro)),
        podePerguntar: async (ag) => !(await redisService.get(chaveDoCliente(ag.clienteTelefone))),
        aoEnviar: async (ag, perguntou) => {
          if (perguntou) await redisService.set(chaveDoCliente(ag.clienteTelefone), ag.id, PRAZO_RESPOSTA_SEGUNDOS);
        },
      });
      // Resumo de toda rodada: dá para ver no terminal se o job rodou e por que não mandou
      console.log(`[WHATSAPP] Rodada de lembretes (${provider.recebeRespostas ? 'QR code' : 'webhook'}): ${naJanela} atendimento(s) entre 2h e 24h, ${jaAvisados} já avisado(s), ${enviados} lembrete(s) enviado(s).`);
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
    semPendencia: () => console.log(`[WhatsApp Webhook] Resposta 1/2 de ${mascararTelefone(telefone)} | Agendamento encontrado: nenhum lembrete pendente (ignorada).`),
    marcarAusencia: async (agendamentoId) => {
      // Grava e lê juntos: o aviso sai com os dados do mesmo agendamento que foi marcado
      const ag = await prisma.$transaction(async (tx) => {
        const { count } = await tx.agendamento.updateMany({ where: filtroMarcarAusencia(agendamentoId, telefone), data: { clienteAvisouAusenciaEm: new Date() } });
        return count === 0 ? null : tx.agendamento.findUnique({ where: { id: agendamentoId }, select: { data: true, colaboradorId: true, cliente: { select: { nome: true } } } });
      });
      console.log(`[WhatsApp Webhook] Resposta "Não" de ${mascararTelefone(telefone)} | Agendamento encontrado: ${ag ? agendamentoId : 'não (já cancelado, concluído, avisado ou telefone mudou)'}`);
      if (!ag) return false;
      eventos.notificarMudanca(ESCOPOS.agenda);
      eventos.avisarAusencia({ agendamentoId, cliente: ag.cliente.nome, data: diaMesDe(ag.data), horario: horaDe(ag.data), colaboradorId: ag.colaboradorId });
      return true;
    },
  });
};
