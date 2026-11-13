import { config, validarConfigProducao } from './env';
import express, { Request, Response, NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { createRouter } from './routes';
import { createAutoatendimentoRouter } from './routes/autoatendimentoRoutes';
import { prisma } from './db';
import { getJwtSecret } from './auth';
import { configurarSocket, criarEventos } from './lib/eventos';
import { hostDaRequisicao, responderErro } from './lib/http';
import { redactSensitiveData } from '../shared/redact';
import { ESCOPOS } from '../shared/escopos';
import { LIMITE_LEMBRETES_POR_RODADA, enviarLembretes, filtroLembretes } from './services/whatsapp';
import { whatsapp } from './services/communicationService';
import { getEmpresaConfig } from './services/configService';
import { redisService } from './services/redisService';

// Falha cedo: sem segredo JWT forte qualquer um poderia forjar tokens
try {
  getJwtSecret();
  const errosConfig = validarConfigProducao();
  if (errosConfig.length > 0) throw new Error(errosConfig.join(' '));
} catch (error) {
  console.error(`🚨 ${(error as Error).message}`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
// Conexão ociosa fica aberta mais que o padrão de 5 s do Node: cliente que reaproveita a conexão (navegador, proxy,
// Playwright) no instante em que o servidor a fecha recebia ECONNRESET. headersTimeout precisa ser maior que ele
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// CORS_ORIGINS="https://app.exemplo.com,http://192.168.0.10:3000" define as origens aceitas (obrigatório em produção).
// Sem a variável (só fora de produção), aceita a própria máquina (inclusive subdomínios de localhost, ex.:
// autoatendimento.localhost) e, na rede local, só o mesmo IP onde a API roda (o front servido por esta máquina
// e aberto nos totens, TVs e celulares). Outra máquina da rede não lê respostas com o cookie de quem está logado.
const origensPermitidas = config.corsOrigins;
const REDE_LOCAL = /^https?:\/\/((?:[a-z0-9-]+\.)?localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
const PROPRIA_MAQUINA = /^((?:[a-z0-9-]+\.)?localhost|127\.\d+\.\d+\.\d+)$/;
const origemDaRedeAceita = (origem: string, hostDaApi: string | undefined) => {
  if (!REDE_LOCAL.test(origem)) return false;
  const hostDaOrigem = new URL(origem).hostname;
  return PROPRIA_MAQUINA.test(hostDaOrigem) || (Boolean(hostDaApi) && hostDaOrigem === hostDaApi);
};
const origemPermitida = (origem: string | undefined, hostDaApi?: string) => (origensPermitidas.length > 0
  ? Boolean(origem && origensPermitidas.includes(origem))
  : !origem || origemDaRedeAceita(origem, hostDaApi));
const corsOptions: CorsOptions = {
  origin: origensPermitidas.length > 0
    ? origensPermitidas
    // Só para o socket.io (o HTTP usa a regra do mesmo host, abaixo). Conexão sem sessão é pública (totem, TV);
    // com o cookie da sessão, a origem é conferida com origemPermitida em configurarSocket, que é a barreira real
    : (origem, callback) => callback(null, !origem || REDE_LOCAL.test(origem)),
  // Cookie de sessão nas chamadas do front (que fica em outra origem: porta ou subdomínio diferente)
  credentials: true,
};

const io = new Server(server, { cors: corsOptions });
configurarSocket(io, origemPermitida);
const eventos = criarEventos(io);

// Atrás de proxy reverso (nginx, etc.), use TRUST_PROXY=1 para o rate limit enxergar o IP real
if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);

// Cabeçalhos de segurança da API (só JSON: nada aqui deve ser embutido em iframe nem interpretado como página)
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (config.producao) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors((req, callback) => callback(null, {
  ...corsOptions,
  origin: origensPermitidas.length > 0
    ? origensPermitidas
    : origemPermitida(req.headers.origin, hostDaRequisicao(req.headers.host)),
})));
// Guarda o corpo bruto para validar a assinatura do webhook de pagamento
const lerJson = (limit: string) => express.json({
  limit,
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  },
});
const jsonPadrao = lerJson('100kb');
// A importação de clientes aceita até 500 linhas (~320 bytes cada no pior caso válido): limite próprio, o resto fica pequeno
// Montado antes do padrão: o express.json não lê de novo um corpo já lido
app.use('/api/clientes/importar', lerJson('400kb'));
app.use(jsonPadrao);

app.use('/api', createRouter(eventos));
app.use('/api/autoatendimento', createAutoatendimentoRouter(eventos));

// Middleware Global de Tratamento de Erros (mesma tradução erro -> HTTP das rotas)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  responderErro(res, err, 'Ocorreu um erro interno no servidor.');
});

// Manutenção periódica da agenda (com várias instâncias, ative LIMPEZA_AGENDAMENTOS_DIAS em apenas uma):
// - reservas do totem sem confirmação de pagamento no prazo são canceladas e o horário volta para a grade;
// - agendamentos antigos que nunca foram concluídos viram "no_show" (o histórico é preservado).
const diasLimpeza = config.limpezaAgendamentosDias;
const manutencaoAgenda = async () => {
  try {
    const expirados = await prisma.agendamento.updateMany({
      where: { statusPagamento: 'aguardando_pagamento', status: 'scheduled', lockExpiresAt: { lt: new Date() } },
      data: { status: 'cancelled', statusPagamento: 'expirado' },
    });

    let semConclusao = { count: 0 };
    if (Number.isFinite(diasLimpeza) && diasLimpeza > 0) {
      const dataLimite = new Date(Date.now() - diasLimpeza * 86_400_000);
      semConclusao = await prisma.agendamento.updateMany({
        where: { status: 'scheduled', data: { lt: dataLimite } },
        data: { status: 'no_show' },
      });
    }

    if (expirados.count + semConclusao.count > 0) {
      console.log(`🧹 [AGENDA] ${expirados.count} reserva(s) sem pagamento cancelada(s); ${semConclusao.count} agendamento(s) antigo(s) marcado(s) como não comparecimento.`);
      eventos.notificarMudanca(ESCOPOS.manutencao);
    }
  } catch (error) {
    console.error('🚨 Erro na manutenção da agenda:', redactSensitiveData(error));
  }
};
setInterval(manutencaoAgenda, 5 * 60 * 1000);

// Lembrete de 24h por WhatsApp (só com WHATSAPP_WEBHOOK_URL). Marca antes de enviar: na falha, não repete (melhor
// perder um lembrete que mandar vários). A marca dura 2 dias, mais que a janela de 24h.
let lembretesRodando = false;
const lembretesWhatsapp = async () => {
  // Provedor lento (8 s por envio) pode passar dos 10 min do intervalo: uma rodada por vez
  if (lembretesRodando) return;
  lembretesRodando = true;
  try {
    const enviados = await enviarLembretes({
      provider: whatsapp,
      empresa: (await getEmpresaConfig()).nomeEmpresa,
      agora: new Date(),
      buscar: async (de, ate) => (await prisma.agendamento.findMany({
        where: filtroLembretes(de, ate),
        select: { id: true, data: true, cliente: { select: { nome: true, telefone: true } } },
        orderBy: { data: 'asc' },
        take: LIMITE_LEMBRETES_POR_RODADA,
      })).map((ag) => ({ id: ag.id, data: ag.data, clienteNome: ag.cliente.nome, clienteTelefone: ag.cliente.telefone })),
      marcarUmaVez: (id) => redisService.acquireLock(`lembrete-24h:${id}`, 2 * 86_400, '1'),
      registrarFalha: (id, erro) => console.error(`[WHATSAPP] Lembrete do agendamento ${id} não enviado:`, erro instanceof Error ? erro.message : 'erro desconhecido'),
    });
    if (enviados > 0) console.log(`[WHATSAPP] ${enviados} lembrete(s) enviado(s).`);
  } catch (error) {
    console.error('🚨 Erro nos lembretes por WhatsApp:', redactSensitiveData(error));
  } finally {
    lembretesRodando = false;
  }
};
if (whatsapp.ativo) setInterval(lembretesWhatsapp, 10 * 60 * 1000);

// Porta definida no .env (padrão 3333)
const PORT = config.porta;
// Rede de segurança: uma promessa rejeitada sem tratamento (ex.: erro em middleware async, que o Express 4 não
// captura) é registrada em vez de derrubar a API para todo mundo
process.on('unhandledRejection', (motivo) => {
  console.error('[API] Promessa rejeitada sem tratamento:', redactSensitiveData(motivo));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor escutando em todas as interfaces na porta ${PORT}`);
});
