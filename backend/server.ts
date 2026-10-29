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
import { responderErro } from './lib/http';
import { redactSensitiveData } from '../shared/redact';
import { ESCOPOS } from '../shared/escopos';

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

// CORS_ORIGINS="https://app.exemplo.com,http://192.168.0.10:3000" define as origens aceitas (obrigatório em produção).
// Sem a variável (só fora de produção), aceita a própria máquina e a rede local (totens, TVs, celulares da equipe).
const origensPermitidas = config.corsOrigins;
const REDE_LOCAL = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
const corsOptions: CorsOptions = {
  origin: origensPermitidas.length > 0
    ? origensPermitidas
    : (origem, callback) => callback(null, !origem || REDE_LOCAL.test(origem)),
};

const io = new Server(server, { cors: corsOptions });
configurarSocket(io);
const eventos = criarEventos(io);

// Atrás de proxy reverso (nginx, etc.), use TRUST_PROXY=1 para o rate limit enxergar o IP real
if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);

app.use(cors(corsOptions));
// Guarda o corpo bruto para validar a assinatura do webhook de pagamento
app.use(express.json({
  limit: '100kb',
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

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

// Porta definida no .env (padrão 3333)
const PORT = config.porta;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor escutando em todas as interfaces na porta ${PORT}`);
});
