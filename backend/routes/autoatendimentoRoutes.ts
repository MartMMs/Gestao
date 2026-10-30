import { Router, Request } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { config as ambiente } from '../env';
import { usuarioGerenciaAgenda, verificarSupervisorToken, verificarToken } from '../auth';
import { redisService } from '../services/redisService';
import { communicationService } from '../services/communicationService';
import { comDisponibilidadePagamento, gatewayPagamento, getAutoatendimentoConfig, getEmpresaConfig, pagamentoOnlineDisponivel } from '../services/configService';
import {
  agendamentosDoDia,
  blocosDoIntervalo,
  chaveTravaProfissional,
  chaveTravaSala,
  erroElegibilidade,
  existeTrava,
  mensagemIndisponibilidadeEscala, mensagemForaDoTurno,
  verificarCLTInterjornada,
} from '../services/agendaService';
import { HttpError, responderErro, ipDoCliente } from '../lib/http';
import { redactSensitiveData } from '../../shared/redact';
import {
  PAPEIS_ATENDIMENTO,
  type SessaoReservaTotem,
  calcularCobranca,
  criarAgendamentoTotem,
  duracaoProduto,
  escolherProfissionalESala,
  lerClienteTotem,
  lerIdsServicos,
  liberarReserva,
  resumoServicos,
  travarHorario,
  validarConfigAutoatendimento,
} from '../services/autoatendimentoService';
import { buscarServicosPorId } from '../services/servicoService';
import type { Eventos } from '../lib/eventos';
import {
  HORA_ABERTURA,
  HORA_FECHAMENTO,
  INTERVALO_SLOT_TOTEM_MIN,
  dataValida,
  duracaoServico,
  horarioParaMinutos,
  horarioValido,
  instanteNoFuso,
  intervalosSobrepoem,
  minutosParaHorario,
  partesNoFuso,
  validarHorarioAgendamento,
} from '../../shared/agenda';
import { normalizarTelefone } from '../../shared/validadores';
import { ESCOPOS } from '../../shared/escopos';

const TTL_RESULTADO_SEGUNDOS = 15 * 60;
const TTL_CONFIRMACAO_SEGUNDOS = 120;
// Limites contra quem tenta travar a agenda com reservas em massa
const HORIZONTE_RESERVA_DIAS = 60;
const MAX_RESERVAS_POR_IP = ambiente.totemMaxReservasPorIp;
// Requisições por minuto por IP nas rotas públicas do totem
const MAX_REQUISICOES_POR_MINUTO = ambiente.totemMaxRequisicoesPorMinuto;
const JANELA_RESERVAS_SEGUNDOS = 10 * 60;

const limiteDeData = () => {
  const limite = new Date(Date.now() + HORIZONTE_RESERVA_DIAS * 86_400_000);
  return partesNoFuso(limite).data;
};

// Janela aceita entre o carimbo de tempo assinado e o relógio do servidor (barra reenvio de chamadas antigas)
const WEBHOOK_TOLERANCIA_SEGUNDOS = 5 * 60;
// Diferença de arredondamento tolerada ao comparar o valor pago com o cobrado
const TOLERANCIA_VALOR = 0.01;

// Assinatura = HMAC-SHA256 de `${timestamp}.${corpo}`; timestamp em segundos no cabeçalho x-webhook-timestamp
const assinaturaValida = (req: Request, segredo: string) => {
  const assinatura = String(req.headers['x-webhook-signature'] || '');
  const timestamp = Number(req.headers['x-webhook-timestamp']);
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCIA_SEGUNDOS) return false;
  const corpo = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('');
  const esperada = crypto.createHmac('sha256', segredo).update(`${timestamp}.`).update(corpo).digest('hex');
  return assinatura.length === esperada.length && crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada));
};

// Texto do voucher a partir da configuração real do totem (o cancelamento é feito pela recepção)
const politicaCancelamento = (config: { permitirCancelamento: boolean; tempoMinimoCancelamentoHoras: number }) =>
  config.permitirCancelamento
    ? `Cancelamento gratuito pela recepção até ${config.tempoMinimoCancelamentoHoras} hora(s) antes do horário agendado. Tolerância de atraso de 10 minutos.`
    : 'Esta reserva não permite cancelamento gratuito. Fale com a recepção em caso de imprevisto.';

// Resposta da confirmação guardada para repetir o mesmo resultado (idempotência)
type ResultadoConfirmacao = {
  sucesso: boolean;
  agendamentoId: string;
  aguardandoPagamento: boolean;
  voucher: ReturnType<typeof communicationService.generateVoucher>;
};

export function createAutoatendimentoRouter(eventos: Eventos) {
  const router = Router();

  // Rate limit por IP para as rotas públicas. O webhook fica fora: o gateway chama de poucos IPs fixos e um 429
  // faria confirmações de pagamento se perderem (ele é protegido pela assinatura HMAC com timestamp).
  router.use(async (req, res, next) => {
    try {
      // Webhook: limite próprio e folgado (o gateway chama de poucos IPs fixos; o do totem cortaria confirmações)
      if (req.path === '/webhook-pagamento') {
        const limite = await redisService.rateLimit(`ratelimit:webhook:${ipDoCliente(req)}`, 600, 60);
        return limite.allowed ? next() : res.status(429).json({ erro: 'Muitas chamadas ao webhook.' });
      }
      const ip = ipDoCliente(req);
      const check = await redisService.rateLimit(`ratelimit:autoatendimento:${ip}`, MAX_REQUISICOES_POR_MINUTO, 60);
      if (!check.allowed) {
        return res.status(429).json({ erro: 'Muitas tentativas em pouco tempo. Por favor, aguarde um minuto e tente novamente.' });
      }
      next();
    } catch (error) {
      responderErro(res, error, 'Erro ao verificar limite de requisições.');
    }
  });

  router.get('/empresa', async (_req, res) => {
    try {
      res.json(await getEmpresaConfig());
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar dados da empresa.');
    }
  });

  router.get('/config', async (_req, res) => {
    try {
      res.json(comDisponibilidadePagamento(await getAutoatendimentoConfig()));
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar configurações de autoatendimento.');
    }
  });

  router.put('/config', verificarSupervisorToken, async (req, res) => {
    try {
      const dados = validarConfigAutoatendimento(req.body ?? {});
      await getAutoatendimentoConfig();
      const config = await prisma.configuracaoAutoatendimento.update({ where: { id: 'default' }, data: dados });
      eventos.emitirConfigAutoatendimento(comDisponibilidadePagamento(config));
      eventos.notificarMudanca();
      res.json(comDisponibilidadePagamento(config));
    } catch (error) {
      responderErro(res, error, 'Falha ao salvar configurações de autoatendimento.');
    }
  });

  router.get('/servicos', async (_req, res) => {
    try {
      const servicos = await prisma.servico.findMany({ orderBy: { nome: 'asc' } });
      // Lista de profissionais exclusivos é interna; o catálogo público não precisa dela
      res.json(servicos.map(({ profissionaisPermitidos: _ids, ...s }) => s));
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar catálogo de serviços.');
    }
  });

  router.get('/salas', async (_req, res) => {
    try {
      res.json(await prisma.sala.findMany({ where: { ativa: true }, orderBy: { numero: 'asc' } }));
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar espaços e salas.');
    }
  });

  // Disponibilidade: para cada horário, o primeiro profissional e a primeira sala livres
  router.get('/disponibilidade', async (req, res) => {
    try {
      const { data } = req.query;
      if (!dataValida(data)) return res.status(400).json({ erro: 'Informe uma data válida (AAAA-MM-DD).' });
      const hoje = partesNoFuso(new Date()).data;
      if (data < hoje) return res.status(400).json({ erro: 'Escolha uma data a partir de hoje.' });
      if (data > limiteDeData()) {
        return res.status(400).json({ erro: `Reservas pelo totem podem ser feitas com até ${HORIZONTE_RESERVA_DIAS} dias de antecedência.` });
      }

      const servicos = await buscarServicosPorId(prisma, lerIdsServicos(req.query.servicoIds, req.query.servicoId));
      const resumo = resumoServicos(servicos);

      const [colaboradores, salas, agendamentos, escalas] = await Promise.all([
        prisma.colaborador.findMany({
          where: { ativo: true, papel: { in: PAPEIS_ATENDIMENTO } },
          include: { bloqueios: { where: { data } } },
          orderBy: { nome: 'asc' },
        }),
        prisma.sala.findMany({ where: { ativa: true }, orderBy: { numero: 'asc' } }),
        agendamentosDoDia(prisma, data),
        prisma.escalaOverride.findMany({ where: { data } }),
      ]);

      const indisponivelNaEscala = new Set(escalas.filter((e) => mensagemIndisponibilidadeEscala(e)).map((e) => e.colaboradorId));
      const elegiveis = colaboradores.filter((c) => !indisponivelNaEscala.has(c.id) && !erroElegibilidade(c, servicos));
      const agora = new Date();

      const slots: Array<{
        horario: string;
        disponivel: boolean;
        terapeuta?: { id: string; nome: string; especialidade: string };
        sala?: { id: string; nome: string; numero: number | null };
        motivoIndisponibilidade?: string;
      }> = [];

      for (let inicio = HORA_ABERTURA * 60; inicio + resumo.duracaoTotalSlot <= HORA_FECHAMENTO * 60; inicio += INTERVALO_SLOT_TOTEM_MIN) {
        const horario = minutosParaHorario(inicio);
        // Horários que já passaram não são oferecidos
        if (validarHorarioAgendamento(data, horario, resumo.duracaoTotalSlot, { agora, intervaloMin: INTERVALO_SLOT_TOTEM_MIN })) continue;
        const fim = inicio + resumo.duracaoTotalSlot;
        const blocos = blocosDoIntervalo(inicio, fim);

        let terapeuta: (typeof elegiveis)[number] | null = null;
        for (const colab of elegiveis) {
          const bloqueado = colab.bloqueios.some((b) =>
            intervalosSobrepoem(inicio, fim, horarioParaMinutos(b.horaInicio), horarioParaMinutos(b.horaFim)));
          if (bloqueado) continue;
          if (mensagemForaDoTurno(escalas.find((e) => e.colaboradorId === colab.id) ?? null, inicio, fim)) continue;
          if (agendamentos.some((ag) => ag.colaboradorId === colab.id && intervalosSobrepoem(inicio, fim, ag.inicioMin, ag.fimMin))) continue;
          if (await existeTrava(blocos.map((t) => chaveTravaProfissional(data, t, colab.id)))) continue;
          // Mesma regra de CLT usada na reserva: evita oferecer horário que seria recusado em seguida
          if (await verificarCLTInterjornada(prisma, colab.id, instanteNoFuso(data, horario), resumo.duracaoTotalSlot)) continue;
          terapeuta = colab;
          break;
        }

        let sala: (typeof salas)[number] | null = null;
        if (terapeuta) {
          for (const s of salas) {
            if (agendamentos.some((ag) => ag.salaId === s.id && intervalosSobrepoem(inicio, fim, ag.inicioMin, ag.fimMin))) continue;
            if (await existeTrava(blocos.map((t) => chaveTravaSala(data, t, s.id)))) continue;
            sala = s;
            break;
          }
        }

        slots.push(terapeuta && sala
          ? {
            horario,
            disponivel: true,
            terapeuta: { id: terapeuta.id, nome: terapeuta.nome, especialidade: terapeuta.especialidade },
            sala: { id: sala.id, nome: sala.nome, numero: sala.numero },
          }
          : {
            horario,
            disponivel: false,
            motivoIndisponibilidade: !terapeuta ? 'Sem profissional disponível no horário' : 'Todas as salas ocupadas no horário',
          });
      }

      res.json({
        data,
        servicos: servicos.map((s) => ({
          id: s.id, nome: s.nome, preco: s.preco, duracao: duracaoProduto(s), tempoHigienizacaoMin: duracaoServico(s) - duracaoProduto(s),
        })),
        servico: {
          id: servicos[0].id,
          nome: servicos.map((s) => s.nome).join(' + '),
          preco: resumo.valorTotal,
          duracao: resumo.duracaoTotalProdutos,
          tempoHigienizacaoMin: resumo.bufferHigienizacao,
        },
        ...resumo,
        slots,
        ...(slots.length === 0 ? { mensagem: 'Não há horários disponíveis para esta data.' } : {}),
      });
    } catch (error) {
      responderErro(res, error, 'Erro ao calcular disponibilidade.');
    }
  });

  // Reserva temporária: trava profissional e sala no Redis enquanto o cliente conclui o cadastro
  router.post('/reservar-slot', async (req, res) => {
    try {
      const { data, horario, terapeutaId, salaId } = req.body ?? {};
      if (!dataValida(data) || !horarioValido(horario)) return res.status(400).json({ erro: 'Informe data e horário válidos.' });
      if (data > limiteDeData()) {
        return res.status(400).json({ erro: `Reservas pelo totem podem ser feitas com até ${HORIZONTE_RESERVA_DIAS} dias de antecedência.` });
      }

      const ip = ipDoCliente(req);
      const reservasDoIp = await redisService.rateLimit(`ratelimit:reservas:${ip}`, MAX_RESERVAS_POR_IP, JANELA_RESERVAS_SEGUNDOS);
      if (!reservasDoIp.allowed) {
        return res.status(429).json({ erro: 'Muitas reservas seguidas neste dispositivo. Aguarde alguns minutos ou peça ajuda na recepção.' });
      }

      const config = await getAutoatendimentoConfig();
      if (!config.ativo) {
        return res.status(403).json({ erro: 'O autoatendimento está temporariamente desativado pela administração.', desativado: true });
      }

      const servicos = await buscarServicosPorId(prisma, lerIdsServicos(req.body.servicoIds, req.body.servicoId));
      const resumo = resumoServicos(servicos);
      const erroHorario = validarHorarioAgendamento(data, horario, resumo.duracaoTotalSlot, {
        agora: new Date(),
        intervaloMin: INTERVALO_SLOT_TOTEM_MIN,
      });
      if (erroHorario) return res.status(400).json({ erro: erroHorario });

      const inicio = instanteNoFuso(data, horario);
      const inicioMin = horarioParaMinutos(horario);

      const escolha = await escolherProfissionalESala(inicio, servicos, resumo.duracaoTotalSlot, { terapeutaId, salaId });
      if ('erro' in escolha) return res.status(409).json({ erro: escolha.erro });
      const { terapeuta, sala } = escolha;

      const sessionToken = crypto.randomUUID();
      const ttlSegundos = Math.max(120, (config.tempoLockMinutos || 10) * 60);
      const lockKeys = await travarHorario(data, inicioMin, resumo.duracaoTotalSlot, terapeuta.id, sala.id, sessionToken, ttlSegundos);
      if (!lockKeys) {
        return res.status(409).json({ erro: 'Este horário acabou de ser selecionado por outro cliente. Por favor, escolha outro.' });
      }

      // Sem gateway conectado, nada é cobrado online (ver pagamentoOnlineDisponivel)
      const cobraOnline = config.exigirPagamento && pagamentoOnlineDisponivel();
      const valorSinal = cobraOnline
        ? Math.round(resumo.valorTotal * (config.percentualSinal / 100) * 100) / 100
        : 0;
      const lockExpiresAt = Date.now() + ttlSegundos * 1000;
      const sessao: SessaoReservaTotem = {
        sessionToken,
        servicoIds: servicos.map((s) => s.id),
        servicosNomes: servicos.map((s) => s.nome),
        servicoNome: servicos.map((s) => s.nome).join(' + '),
        servicoId: servicos[0].id,
        data,
        horario,
        terapeutaId: terapeuta.id,
        salaId: sala.id,
        terapeutaNome: terapeuta.nome,
        salaNome: sala.nome,
        duracao: resumo.duracaoTotalProdutos,
        bufferHigienizacao: resumo.bufferHigienizacao,
        duracaoTotalSlot: resumo.duracaoTotalSlot,
        valorTotal: resumo.valorTotal,
        valorSinal,
        exigirPagamento: cobraOnline,
        percentualSinal: config.percentualSinal,
        instrucoesCheckin: config.instrucoesCheckin,
        tempoLockMinutos: Math.round(ttlSegundos / 60),
        lockKeys,
        lockExpiresAt,
      };
      // Com pagamento online, a cobrança (código Pix etc.) vem do gateway do banco; o totem nunca monta uma
      if (cobraOnline && gatewayPagamento) {
        // Uma cobrança para cada opção do checkout (sinal ou integral): o código mostrado tem o valor que o cliente escolher
        const sinal = await gatewayPagamento.criarCobranca({ sessionToken, valor: valorSinal, descricao: sessao.servicoNome });
        const integral = await gatewayPagamento.criarCobranca({ sessionToken, valor: resumo.valorTotal, descricao: `${sessao.servicoNome} (integral)` });
        Object.assign(sessao, sinal, { pixCopiaEColaIntegral: integral.pixCopiaECola, pixQrCodeIntegral: integral.pixQrCode });
      }
      await redisService.setSession(`reserva:${sessionToken}`, sessao, ttlSegundos);

      eventos.avisarEquipe('slot_temporariamente_reservado', { data, horario });
      const { lockKeys: _chaves, ...detalhes } = sessao;
      res.status(201).json({ sucesso: true, sessionToken, lockExpiresAt, tempoRestanteSegundos: ttlSegundos, detalhes });
    } catch (error) {
      responderErro(res, error, 'Erro ao reservar horário.');
    }
  });

  router.get('/sessao/:sessionToken', async (req, res) => {
    try {
      const chave = `reserva:${req.params.sessionToken}`;
      const sessao = await redisService.getSession<SessaoReservaTotem>(chave);
      if (!sessao) return res.status(404).json({ erro: 'Sessão expirada ou não encontrada. O horário foi liberado.', expirado: true });
      const ttl = await redisService.getTtl(chave);
      const { lockKeys: _chaves, ...publica } = sessao;
      res.json({ ...publica, tempoRestanteSegundos: Math.max(0, ttl), expirado: ttl <= 0 });
    } catch (error) {
      responderErro(res, error, 'Erro ao consultar sessão.');
    }
  });

  /**
   * Confirma a reserva e cria o agendamento.
   * - O pagamento NUNCA é marcado como pago aqui: com pagamento online o status fica "aguardando_pagamento"
   *   até o gateway confirmar pelo webhook assinado.
   * - Idempotente: repetir a chamada com o mesmo sessionToken devolve o mesmo resultado.
   * - Não revela dados de clientes já cadastrados.
   */
  router.post('/confirmar-pagamento', async (req, res) => {
    const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : '';
    if (!sessionToken) return res.status(400).json({ erro: 'Reserva não informada.' });
    const chaveResultado = `resultado:${sessionToken}`;
    const chaveConfirmacao = `confirmacao:${sessionToken}`;

    try {
      // Repetição da mesma confirmação devolve o mesmo resultado, mas só para quem informa o mesmo telefone
      const anterior = await redisService.getSession<ResultadoConfirmacao>(chaveResultado);
      if (anterior) {
        if (normalizarTelefone(req.body.cliente?.telefone) !== anterior.voucher?.clienteTelefone) {
          return res.status(409).json({ erro: 'Esta reserva já foi confirmada.' });
        }
        return res.status(201).json(anterior);
      }

      const cliente = lerClienteTotem(req.body.cliente);
      const tipoPagamento = req.body.tipoPagamento === 'integral' ? 'integral' : 'sinal';
      const metodoPagamento = req.body.metodoPagamento === 'cartao' ? 'cartao' : 'pix';

      if (!(await redisService.acquireLock(chaveConfirmacao, TTL_CONFIRMACAO_SEGUNDOS, sessionToken))) {
        return res.status(409).json({ erro: 'Sua confirmação já está sendo processada. Aguarde alguns segundos.' });
      }

      try {
        const sessao = await redisService.getSession<SessaoReservaTotem>(`reserva:${sessionToken}`);
        if (!sessao) {
          const config = await getAutoatendimentoConfig();
          return res.status(410).json({
            erro: `O tempo de reserva (${config.tempoLockMinutos} minutos) terminou e o horário foi liberado. Escolha um novo horário.`,
            expirado: true,
          });
        }

        // Sem valor a cobrar (serviço gratuito ou sinal de 0%) não há pagamento online a esperar
        const cobranca = calcularCobranca(sessao, tipoPagamento);
        let agendamento;
        try {
          agendamento = await criarAgendamentoTotem(sessao, cliente, { sessionToken, cobranca, metodoPagamento });
        } catch (error) {
          // Reserva já virou agendamento (o resultado guardado no Redis se perdeu): não cria outro
          if ((error as { code?: string })?.code === 'P2002') throw new HttpError(409, 'Esta reserva já foi confirmada.');
          throw error;
        }

        const voucher = communicationService.generateVoucher({
          id: agendamento.id,
          clienteNome: cliente.nome,
          clienteTelefone: cliente.telefone,
          terapiaNome: sessao.servicoNome,
          duracaoMin: sessao.duracao,
          data: sessao.data,
          horario: sessao.horario,
          terapeutaNome: sessao.terapeutaNome,
          salaNome: sessao.salaNome,
          valorTotal: sessao.valorTotal,
          valorSinal: cobranca.valorACobrar,
          statusPagamento: cobranca.rotuloVoucher,
          orientacoesCheckIn: sessao.instrucoesCheckin ? [sessao.instrucoesCheckin] : undefined,
          politicaCancelamento: politicaCancelamento(await getAutoatendimentoConfig()),
        });
        const resposta = { sucesso: true, agendamentoId: agendamento.id, aguardandoPagamento: cobranca.comPagamentoOnline, voucher };

        // O agendamento já existe: daqui em diante, falhas (ex.: Redis fora) não podem esconder o voucher do cliente
        try {
          await liberarReserva(sessionToken, sessao);
          await redisService.setSession(chaveResultado, resposta, TTL_RESULTADO_SEGUNDOS);
          await communicationService.enqueueTransactionalNotifications(voucher);
        } catch (error) {
          console.error('[TOTEM] Agendamento criado, mas a finalização falhou:', redactSensitiveData(error));
        }

        // Eventos sem dados pessoais: as telas apenas recarregam
        eventos.notificarMudanca(ESCOPOS.reservaTotem);
        eventos.avisarEquipe('novo_agendamento_autoatendimento', { data: sessao.data, horario: sessao.horario });

        res.status(201).json(resposta);
      } finally {
        // A trava expira sozinha (TTL); falhar aqui não pode virar uma segunda resposta
        await redisService.releaseLock(chaveConfirmacao, sessionToken).catch(() => {});
      }
    } catch (error) {
      responderErro(res, error, 'Erro ao confirmar o agendamento.');
    }
  });

  router.post('/cancelar-reserva', async (req, res) => {
    try {
      const sessionToken = typeof req.body?.sessionToken === 'string' ? req.body.sessionToken : '';
      if (!sessionToken) return res.status(400).json({ erro: 'Reserva não informada.' });
      const sessao = await redisService.getSession<SessaoReservaTotem>(`reserva:${sessionToken}`);
      if (sessao) {
        await liberarReserva(sessionToken, sessao);
        eventos.notificarMudanca(ESCOPOS.reservaTotem);
      }
      res.json({ sucesso: true, mensagem: 'Reserva cancelada e horário liberado.' });
    } catch (error) {
      responderErro(res, error, 'Erro ao cancelar reserva.');
    }
  });

  /**
   * Webhook do gateway de pagamento. Exige `x-webhook-timestamp` (segundos, até 5 min de diferença) e
   * `x-webhook-signature` = HMAC-SHA256 de `${timestamp}.${corpo}` com PAYMENT_WEBHOOK_SECRET.
   * Corpo: { event: 'payment.succeeded', agendamentoId, valorPago, tipo: 'sinal' | 'integral' }
   * Só confirma uma vez (reenvios não mudam nada) e o valor pago precisa cobrir o valor cobrado.
   */
  router.post('/webhook-pagamento', async (req, res) => {
    try {
      const segredo = ambiente.pagamentoWebhookSecret;
      if (!segredo) return res.status(503).json({ erro: 'Webhook de pagamento não configurado.' });
      if (!assinaturaValida(req, segredo)) return res.status(401).json({ erro: 'Assinatura inválida.' });

      const { event, agendamentoId, valorPago, tipo } = req.body ?? {};
      if (event !== 'payment.succeeded') return res.json({ received: true });
      if (typeof agendamentoId !== 'string') return res.status(400).json({ erro: 'agendamentoId obrigatório.' });
      if (tipo !== 'sinal' && tipo !== 'integral') return res.status(400).json({ erro: 'tipo deve ser "sinal" ou "integral".' });
      const valor = Number(valorPago);
      if (!Number.isFinite(valor) || valor <= 0) return res.status(400).json({ erro: 'valorPago inválido.' });

      const agendamento = await prisma.agendamento.findUnique({
        where: { id: agendamentoId },
        select: { valorSinal: true, valorTotal: true, statusPagamento: true, status: true },
      });
      if (!agendamento) return res.status(404).json({ erro: 'Agendamento não encontrado.' });
      // Reenvio de um pagamento já registrado (mesmo tipo) não muda nada, nem depois de cancelado
      const jaRegistrado = agendamento.statusPagamento === 'integral_pago' || agendamento.statusPagamento === 'pago_apos_expirar'
        || (tipo === 'sinal' && agendamento.statusPagamento === 'sinal_pago');
      if (jaRegistrado) return res.json({ received: true, atualizado: false });
      // Integral depois do sinal: o cliente paga só o restante
      const esperado = tipo === 'integral'
        ? (agendamento.statusPagamento === 'sinal_pago' ? (agendamento.valorTotal ?? 0) - (agendamento.valorSinal ?? 0) : agendamento.valorTotal)
        : agendamento.valorSinal;
      // Agendamento sem valor a cobrar nunca é "pago" pelo gateway
      if (esperado === null || esperado <= 0) return res.status(422).json({ erro: 'Este agendamento não tem valor a cobrar online.' });
      if (valor + TOLERANCIA_VALOR < esperado) {
        return res.status(422).json({ erro: 'Valor pago menor que o valor cobrado.' });
      }

      const novoStatus = tipo === 'integral' ? 'integral_pago' : 'sinal_pago';
      // Só confirma reserva ATIVA. O filtro por status torna a confirmação idempotente (reenvio não altera nada);
      // integral depois do sinal completa o pagamento em vez de ser descartado.
      const atualizado = await prisma.agendamento.updateMany({
        where: {
          id: agendamentoId,
          // Concluído também: o cliente pode pagar no fim do atendimento
          status: { in: ['scheduled', 'completed'] },
          statusPagamento: tipo === 'integral' ? { in: ['aguardando_pagamento', 'sinal_pago'] } : 'aguardando_pagamento',
        },
        data: { statusPagamento: novoStatus },
      });
      if (atualizado.count > 0) {
        eventos.notificarMudanca(ESCOPOS.reservaTotem);
        return res.json({ received: true, atualizado: true });
      }

      // Pagamento para reserva que expirou ou foi cancelada pela equipe: o cliente pagou e ficou sem horário.
      // Marca o agendamento e avisa a equipe para devolver ou remarcar, em vez de responder 200 sem deixar rastro.
      const tardio = await prisma.agendamento.updateMany({
        where: {
          id: agendamentoId,
          OR: [
            { statusPagamento: 'expirado' },
            { status: { in: ['cancelled', 'no_show'] }, statusPagamento: { in: ['aguardando_pagamento', 'sinal_pago'] } },
          ],
        },
        data: { statusPagamento: 'pago_apos_expirar' },
      });
      if (tardio.count > 0) {
        console.warn(`[PAGAMENTO] Pagamento recebido para reserva expirada ou cancelada (agendamento ${agendamentoId}). Requer devolução ou remarcação.`);
        eventos.notificarMudanca(ESCOPOS.reservaTotem);
        eventos.avisarEquipe('pagamento_apos_expirar', { agendamentoId });
      }
      res.json({ received: true, atualizado: false, pagamentoTardio: tardio.count > 0 });
    } catch (error) {
      responderErro(res, error, 'Erro ao processar webhook.');
    }
  });

  // Reimpressão do voucher pela recepção/supervisão (contém telefone completo do cliente)
  router.get('/voucher/:agendamentoId', verificarToken, async (req, res) => {
    try {
      if (!usuarioGerenciaAgenda(req)) return res.status(403).json({ erro: 'Apenas a recepção ou supervisores podem reimprimir vouchers.' });
      const ag = await prisma.agendamento.findUnique({
        where: { id: req.params.agendamentoId },
        include: { cliente: true, colaborador: true, sala: true, servicos: true },
      });
      if (!ag) return res.status(404).json({ erro: 'Agendamento não encontrado.' });

      const { data, horario } = partesNoFuso(ag.data);
      res.json(communicationService.generateVoucher({
        id: ag.id,
        clienteNome: ag.cliente.nome,
        clienteTelefone: ag.cliente.telefone || '',
        terapiaNome: ag.servicos.map((s) => s.nome).join(' + ') || 'Atendimento',
        duracaoMin: ag.servicos.reduce((soma, s) => soma + (s.duracao || 60), 0) || 60,
        data,
        horario,
        terapeutaNome: ag.colaborador.nome,
        salaNome: ag.sala?.nome || 'Cabine Principal',
        valorTotal: ag.valorTotal || ag.servicos.reduce((soma, s) => soma + s.preco, 0),
        valorSinal: ag.valorSinal || 0,
        statusPagamento: ag.statusPagamento || 'pendente',
      }));
    } catch (error) {
      responderErro(res, error, 'Erro ao obter voucher.');
    }
  });

  return router;
}
