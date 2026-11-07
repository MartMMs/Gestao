import { Request, Response } from 'express';
import { redactSensitiveData } from '../../shared/redact';

// Erro com status HTTP e mensagem pronta para o usuário
// `codigo` (opcional) é estável para o front decidir o que fazer sem depender do texto da mensagem
export class HttpError extends Error {
  constructor(public status: number, message: string, public codigo?: string) {
    super(message);
  }
}

// Dependência fora do ar (ex.: Redis em produção): a operação falha fechada com 503
export class ServicoIndisponivelError extends HttpError {
  constructor() {
    super(503, 'Serviço temporariamente indisponível. Tente novamente em instantes.');
    this.name = 'ServicoIndisponivelError';
  }
}

// 40P01 (impasse) chega como P2010 com meta.code numa consulta crua (travarChave, FOR UPDATE) e sem código num
// update comum (só no texto do erro); P2034 é o conflito de serialização
export const conflitoDeTransacao = (error: unknown) => {
  const { code, meta, message } = (error ?? {}) as { code?: string; meta?: { code?: string }; message?: string };
  return code === 'P2034' || meta?.code === '40P01' || /40P01|deadlock detected/.test(String(message));
};

// Responde erros conhecidos com a mensagem deles; os demais viram 500 genérico (detalhes só no log).
// Usado pelas rotas e pelo middleware global de erros do servidor (fonte única da tradução erro -> HTTP).
export const responderErro = (res: Response, error: unknown, mensagemPadrao: string) => {
  // Resposta já enviada (falha depois do envio): só registra, nunca responde duas vezes
  if (res.headersSent) {
    console.error(`[API] ${mensagemPadrao} (após a resposta):`, redactSensitiveData(error));
    return res;
  }
  if (error instanceof HttpError) return res.status(error.status).json({ erro: error.message, ...(error.codigo ? { code: error.codigo } : {}) });
  const tipo = (error as { type?: string })?.type;
  if (tipo === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
  if (tipo === 'entity.too.large') return res.status(413).json({ erro: 'Dados enviados excedem o tamanho permitido.' });
  const codigo = (error as { code?: string })?.code;
  if (codigo === 'P2025') return res.status(404).json({ erro: 'Registro não encontrado.' });
  // Índice único: outro pedido igual gravou entre a checagem e o insert (a rota dá a mensagem específica quando sabe)
  if (codigo === 'P2002') return res.status(409).json({ erro: 'Já existe um registro com estes dados.' });
  // Espera longa por uma trava (P2028: a transação passou do tempo) ou impasse que esgotou as novas tentativas
  if (codigo === 'P2028' || conflitoDeTransacao(error)) {
    return res.status(503).json({ erro: 'Outra operação está alterando estes dados agora. Tente salvar de novo em instantes.' });
  }
  console.error(`[API] ${mensagemPadrao}:`, redactSensitiveData(error));
  return res.status(500).json({ erro: mensagemPadrao });
};

export type Notificar = () => void;

// IP do cliente para limites de tentativas. IPv6 é agrupado pela rede /64 (um aparelho costuma ter a faixa toda,
// e contar endereço por endereço deixaria trocar de IP a cada requisição)
export const ipDoCliente = (req: Request) => {
  const ip = (req.ip || req.socket.remoteAddress || 'desconhecido').replace(/^::ffff:/, '');
  return ip.includes(':') ? `${ip.split(':').slice(0, 4).join(':')}::/64` : ip;
};

// Host (sem porta) em que a requisição chegou: o front da rede local é servido pela mesma máquina.
// Mesma leitura no HTTP (server.ts) e no socket (eventos.ts)
export const hostDaRequisicao = (host: string | undefined) => host?.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
