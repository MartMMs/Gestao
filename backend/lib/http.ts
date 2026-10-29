import { Request, Response } from 'express';
import { redactSensitiveData } from '../../shared/redact';

// Erro com status HTTP e mensagem pronta para o usuário
export class HttpError extends Error {
  constructor(public status: number, message: string) {
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

// Responde erros conhecidos com a mensagem deles; os demais viram 500 genérico (detalhes só no log).
// Usado pelas rotas e pelo middleware global de erros do servidor (fonte única da tradução erro -> HTTP).
export const responderErro = (res: Response, error: unknown, mensagemPadrao: string) => {
  // Resposta já enviada (falha depois do envio): só registra, nunca responde duas vezes
  if (res.headersSent) {
    console.error(`[API] ${mensagemPadrao} (após a resposta):`, redactSensitiveData(error));
    return res;
  }
  if (error instanceof HttpError) return res.status(error.status).json({ erro: error.message });
  const tipo = (error as { type?: string })?.type;
  if (tipo === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados enviados em formato inválido.' });
  if (tipo === 'entity.too.large') return res.status(413).json({ erro: 'Dados enviados excedem o tamanho permitido.' });
  const codigo = (error as { code?: string })?.code;
  if (codigo === 'P2025') return res.status(404).json({ erro: 'Registro não encontrado.' });
  // Conflito de gravação simultânea que esgotou as novas tentativas (ver transacaoSerializavel)
  if (codigo === 'P2034') {
    return res.status(409).json({ erro: 'A agenda mudou enquanto você salvava. Tente salvar novamente.' });
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
