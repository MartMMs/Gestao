/**
 * Prova de trabalho do modo de segurança do login (contra robôs que testam muitas senhas).
 *
 * O servidor entrega um desafio (prefixo aleatório + dificuldade em bits). O navegador procura um número `nonce`
 * tal que SHA-256(`${prefixo}:${nonce}`) comece com `dificuldade` bits zerados. Para uma pessoa isso custa menos
 * de um segundo, uma vez; para um robô que testa milhares de senhas, custa isso a cada tentativa.
 *
 * SHA-256 em JavaScript puro: o `crypto.subtle` do navegador só existe em https ou localhost, e o sistema também
 * roda em http na rede local (totens, tablets). Prefixo e nonce são ASCII, então texto e bytes coincidem.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

// SHA-256 de um texto ASCII; devolve as 8 palavras de 32 bits do resumo
export const sha256Ascii = (texto: string): Uint32Array => {
  const tamanho = texto.length;
  const blocos = Math.ceil((tamanho + 9) / 64);
  const palavras = new Uint32Array(blocos * 16);
  for (let i = 0; i < tamanho; i += 1) palavras[i >> 2] |= (texto.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  palavras[tamanho >> 2] |= 0x80 << (24 - (tamanho % 4) * 8);
  palavras[palavras.length - 1] = tamanho * 8;

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let bloco = 0; bloco < blocos; bloco += 1) {
    for (let t = 0; t < 16; t += 1) w[t] = palavras[bloco * 16 + t];
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return h;
};

export const sha256HexAscii = (texto: string) => Array.from(sha256Ascii(texto), (p) => p.toString(16).padStart(8, '0')).join('');

// Quantos bits zerados no começo do resumo
export const bitsZeroIniciais = (resumo: Uint32Array) => {
  let total = 0;
  for (const palavra of resumo) {
    if (palavra === 0) { total += 32; continue; }
    return total + Math.clz32(palavra);
  }
  return total;
};

export const provaValida = (prefixo: string, nonce: string, dificuldade: number) =>
  /^\d{1,12}$/.test(nonce) && bitsZeroIniciais(sha256Ascii(`${prefixo}:${nonce}`)) >= dificuldade;

export type DesafioLogin = { id: string; prefixo: string; dificuldade: number };

/**
 * Procura o nonce em fatias, devolvendo o controle ao navegador entre elas (a tela não trava).
 * `aoProgredir` recebe quantas tentativas já foram feitas.
 */
export const resolverDesafio = async (
  desafio: Pick<DesafioLogin, 'prefixo' | 'dificuldade'>,
  aoProgredir?: (tentativas: number) => void,
): Promise<string> => {
  const FATIA = 5_000;
  for (let nonce = 0; nonce < 1e12; nonce += 1) {
    if (bitsZeroIniciais(sha256Ascii(`${desafio.prefixo}:${nonce}`)) >= desafio.dificuldade) return String(nonce);
    if (nonce % FATIA === FATIA - 1) {
      aoProgredir?.(nonce + 1);
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  }
  throw new Error('Desafio sem solução.');
};
