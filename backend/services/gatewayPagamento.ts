// Adapter HTTP genérico do gateway de pagamento (Pix/cartão). Puro: recebe a configuração e o fetch, para teste.
// Contrato com o gateway (ou com um serviço intermediário seu que fala com o banco):
//   POST PAYMENT_GATEWAY_URL  Authorization: Bearer PAYMENT_GATEWAY_TOKEN
//   corpo:    { referencia, valor, descricao }   (referencia = id aleatório da cobrança, gravado em referenciaPagamento; volte com ela no webhook. Nunca o sessionToken, que é credencial da reserva)
//   resposta: { pixCopiaECola: string, pixQrCode?: string, cartaoOnlineDisponivel?: boolean }
import type { CobrancaGateway, GatewayPagamento } from './configService';

export class FalhaGatewayError extends Error {}

const TEMPO_LIMITE_MS = 8000;
const TAMANHO_MAXIMO_PIX = 1000;

// A resposta vem de fora: só passa o que tem o formato esperado (o código Pix vai direto para a tela do cliente)
export const lerCobranca = (corpo: unknown): CobrancaGateway => {
  const dados = (corpo ?? {}) as Record<string, unknown>;
  const pix = dados.pixCopiaECola;
  if (typeof pix !== 'string' || !pix.trim() || pix.length > TAMANHO_MAXIMO_PIX) {
    throw new FalhaGatewayError('Resposta do gateway sem código Pix válido.');
  }
  const qr = dados.pixQrCode;
  return {
    pixCopiaECola: pix.trim(),
    ...(typeof qr === 'string' && qr.length <= 200_000 ? { pixQrCode: qr } : {}),
    cartaoOnlineDisponivel: dados.cartaoOnlineDisponivel === true,
  };
};

export const criarGatewayHttp = (
  opcoes: { url: string; token: string },
  buscar: typeof fetch = fetch,
): GatewayPagamento => ({
  criarCobranca: async ({ referencia, valor, descricao }) => {
    let resposta: Response;
    try {
      resposta = await buscar(opcoes.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opcoes.token}` },
        body: JSON.stringify({ referencia, valor, descricao }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
    } catch {
      throw new FalhaGatewayError('Gateway de pagamento fora do ar ou sem resposta.');
    }
    if (!resposta.ok) throw new FalhaGatewayError(`Gateway de pagamento respondeu ${resposta.status}.`);
    return lerCobranca(await resposta.json().catch(() => null));
  },
});
