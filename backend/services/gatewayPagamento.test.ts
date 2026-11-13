import { describe, it, expect, vi } from 'vitest';
import { FalhaGatewayError, criarGatewayHttp, lerCobranca } from './gatewayPagamento';

const resposta = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const RESERVA = { referencia: 'ref-1', valor: 50, descricao: 'Massagem' };

describe('gateway de pagamento (adapter HTTP)', () => {
  it('envia referência, valor e token; devolve só os campos esperados', async () => {
    const buscar = vi.fn(async () => resposta(200, { pixCopiaECola: ' 000201PIX ', pixQrCode: 'data:image/png;base64,AA', cartaoOnlineDisponivel: true, extra: 'x' }));
    const cobranca = await criarGatewayHttp({ url: 'https://gw.test/cobrancas', token: 'segredo' }, buscar).criarCobranca(RESERVA);

    expect(cobranca).toEqual({ pixCopiaECola: '000201PIX', pixQrCode: 'data:image/png;base64,AA', cartaoOnlineDisponivel: true });
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.test/cobrancas');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer segredo');
    expect(JSON.parse(String(init.body))).toEqual({ referencia: 'ref-1', valor: 50, descricao: 'Massagem' });
  });

  it('cartão só é oferecido quando o gateway diz true', () => {
    expect(lerCobranca({ pixCopiaECola: 'abc', cartaoOnlineDisponivel: 'sim' }).cartaoOnlineDisponivel).toBe(false);
    expect(lerCobranca({ pixCopiaECola: 'abc' }).cartaoOnlineDisponivel).toBe(false);
  });

  it('recusa resposta sem código Pix válido', () => {
    for (const corpo of [null, {}, { pixCopiaECola: '' }, { pixCopiaECola: 123 }, { pixCopiaECola: 'x'.repeat(1001) }]) {
      expect(() => lerCobranca(corpo)).toThrow(FalhaGatewayError);
    }
  });

  it('erro HTTP, rede fora ou corpo inválido viram FalhaGatewayError', async () => {
    const gw = (buscar: typeof fetch) => criarGatewayHttp({ url: 'https://gw.test', token: 't' }, buscar).criarCobranca(RESERVA);
    await expect(gw(async () => resposta(500, {}))).rejects.toThrow(FalhaGatewayError);
    await expect(gw(async () => { throw new TypeError('fetch failed'); })).rejects.toThrow(FalhaGatewayError);
    await expect(gw(async () => new Response('não é json', { status: 200 }))).rejects.toThrow(FalhaGatewayError);
  });
});
