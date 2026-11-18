#!/usr/bin/env node
// Checklist de pré-lançamento: testa o que dá para automatizar numa URL e lista o que precisa de teste manual.
// Uso: node scripts/check-site.mjs https://meusite.com [--sem-psi]   (opcional: PSI_API_KEY=... para o PageSpeed sem limite)
// --sem-psi: não manda a URL ao PageSpeed do Google (homologação privada)
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const cor = (codigo) => (texto) => (process.stdout.isTTY ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const verde = cor(32), vermelho = cor(31), amarelo = cor(33), cinza = cor(90), negrito = cor(1);

const MANUAIS = [
  'Testar a submissão de cada formulário (contato, agendamento, login) e ver se a mensagem chega.',
  'Clicar no botão do WhatsApp e nos links de redes sociais.',
  'Abrir no celular e testar a responsividade (menu, tabelas, modais).',
  'Testar nos navegadores principais (Chrome, Safari, Firefox).',
  'Revisar textos, preços e dados de contato com o cliente.',
  'Confirmar que o analytics/pixel registra visitas em produção.',
];

const pedir = (url, opcoes = {}) => fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), ...opcoes });

// Atributos de uma tag HTML ("<meta name=x content='y'>" -> { name: 'x', content: 'y' })
const atributos = (tag) => Object.fromEntries(
  [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]),
);

// shortcut: regex no <head> em vez de um parser HTML; basta para tags de SEO, trocar por cheerio se precisar de mais
export function analisarHead(html) {
  const head = html.split(/<\/head>/i)[0];
  const tags = [...head.matchAll(/<(meta|link)\b[^>]*>/gi)].map((m) => ({ nome: m[1].toLowerCase(), attrs: atributos(m[0]) }));
  const meta = (chave, valor) => tags.find((t) => t.nome === 'meta' && t.attrs[chave]?.toLowerCase() === valor)?.attrs.content?.trim();
  return {
    titulo: head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].trim() || '',
    descricao: meta('name', 'description') || '',
    ogImage: meta('property', 'og:image') || '',
    favicon: tags.some((t) => t.nome === 'link' && (t.attrs.rel || '').toLowerCase().split(/\s+/).includes('icon')),
  };
}

// Dias até o certificado expirar (o fetch já recusa certificado inválido; isto avisa o vencimento)
const diasDoCertificado = (host) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host, port: 443, servername: host, timeout: 15_000 }, () => {
    const validoAte = new Date(socket.getPeerCertificate().valid_to);
    socket.end();
    resolve(Math.floor((validoAte - Date.now()) / 86_400_000));
  });
  socket.on('error', reject);
  socket.on('timeout', () => socket.destroy(new Error('tempo esgotado no TLS')));
});

async function verificar(base, { comPsi = true } = {}) {
  const testes = [];
  const teste = async (nome, fn) => {
    try {
      const { ok, detalhe } = await fn();
      testes.push({ nome, ok, detalhe });
    } catch (erro) {
      testes.push({ nome, ok: false, detalhe: erro.cause?.message || erro.message });
    }
  };

  await teste('HTTP redireciona para HTTPS', async () => {
    const r = await pedir(`http://${base.host}/`, { redirect: 'manual' });
    const destino = r.headers.get('location') || '';
    return { ok: r.status >= 300 && r.status < 400 && destino.startsWith('https://'), detalhe: `${r.status} -> ${destino || '(sem Location)'}` };
  });

  await teste('Certificado SSL válido', async () => {
    await pedir(`https://${base.host}/`, { method: 'HEAD' }); // lança se o certificado for inválido
    const dias = await diasDoCertificado(base.hostname);
    return { ok: dias >= 14, detalhe: `expira em ${dias} dia(s)` };
  });

  await teste('Rota inexistente devolve 404', async () => {
    const r = await pedir(new URL(`/url-aleatoria-${Date.now()}`, base));
    return { ok: r.status === 404, detalhe: `status ${r.status}${r.status === 200 ? ' (SPA sem 404 de verdade?)' : ''}` };
  });

  for (const arquivo of ['/robots.txt', '/sitemap.xml']) {
    await teste(`${arquivo} existe`, async () => {
      const r = await pedir(new URL(arquivo, base));
      return { ok: r.status === 200, detalhe: `status ${r.status}` };
    });
  }

  let head = null;
  const inicio = performance.now();
  await teste('Página inicial responde', async () => {
    const r = await pedir(base);
    head = analisarHead(await r.text());
    return { ok: r.ok, detalhe: `status ${r.status} em ${Math.round(performance.now() - inicio)} ms` };
  });
  if (head) {
    const presente = (valor) => async () => ({ ok: Boolean(valor), detalhe: valor ? String(valor).slice(0, 70) : 'ausente' });
    await teste('<title>', presente(head.titulo));
    await teste('<meta name="description">', presente(head.descricao));
    await teste('<meta property="og:image">', presente(head.ogImage));
    await teste('<link rel="icon"> no <head>', presente(head.favicon && 'declarado'));
  }

  if (comPsi) await teste('PageSpeed (mobile) ≥ 50', async () => {
    const psi = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    psi.searchParams.set('url', base.href);
    psi.searchParams.set('strategy', 'mobile');
    if (process.env.PSI_API_KEY) psi.searchParams.set('key', process.env.PSI_API_KEY);
    const r = await fetch(psi, { signal: AbortSignal.timeout(90_000) });
    const corpo = await r.json();
    if (!r.ok) throw new Error(corpo.error?.message || `PageSpeed respondeu ${r.status}`);
    const nota = Math.round((corpo.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
    const lcp = corpo.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue;
    // 50 = início da faixa "precisa melhorar" do Lighthouse; abaixo disso é ruim
    return { ok: nota >= 50, detalhe: `nota ${nota}/100${lcp ? `, LCP ${lcp}` : ''}` };
  });

  return testes;
}

async function main() {
  const opcoes = process.argv.slice(2);
  const arg = opcoes.find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Uso: node scripts/check-site.mjs https://meusite.com [--sem-psi]');
    process.exit(2);
  }
  let base;
  try {
    base = new URL(/^https?:\/\//i.test(arg) ? arg : `https://${arg}`);
  } catch {
    console.error(`URL inválida: ${arg}`);
    process.exit(2);
  }

  console.log(negrito(`\nChecklist de lançamento: ${base.href}\n`));
  const testes = await verificar(base, { comPsi: !opcoes.includes('--sem-psi') });
  for (const { nome, ok, detalhe } of testes) {
    console.log(`  ${ok ? verde('✔ PASSOU') : vermelho('✘ FALHOU')}  ${nome} ${cinza(`— ${detalhe}`)}`);
  }
  const falhas = testes.filter((t) => !t.ok).length;
  console.log(`\n  ${falhas === 0 ? verde(`Todos os ${testes.length} testes passaram.`) : vermelho(`${falhas} de ${testes.length} falharam.`)}`);

  console.log(amarelo(negrito('\nVerificações Manuais Necessárias')));
  MANUAIS.forEach((item, i) => console.log(amarelo(`  ${i + 1}. ${item}`)));
  console.log('');
  process.exitCode = falhas > 0 ? 1 : 0; // código de saída serve para barrar o deploy no CI
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
