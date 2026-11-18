// O totem de autoatendimento roda num subdomínio próprio (ex.: autoatendimento.suaempresa.com.br).
// Nele só existe o fluxo público: sem login e sem acesso ao portal da equipe. Como o localStorage é por origem,
// a sessão da equipe nunca fica acessível no aparelho do totem.
// Importante: o isolamento da sessão depende de o totem estar num SUBDOMÍNIO (outra origem).
// Servir o totem num caminho do mesmo host (app.x.com/autoatendimento) não separa o localStorage.
import { readEnv } from './env';

const PREFIXO_TOTEM = 'autoatendimento.';
const PREFIXO_TV = 'tv.';

// Host configurado (lista separada por vírgula) ou, sem configuração, qualquer host que comece com o prefixo padrão
function hostCorresponde(hostname: string, configuracao: string | undefined, prefixoPadrao: string): boolean {
  const host = hostname.toLowerCase();
  if (!host) return false;
  const configurados = (configuracao || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (configurados.length > 0) return configurados.includes(host);
  return host.startsWith(prefixoPadrao);
}

const hostAtual = () => (typeof window !== 'undefined' ? window.location.hostname : '');

// Atalho de teste pelo IP (sem subdomínio): /totem e /painel. Mesma origem do portal, então SEM isolamento de sessão:
// num aparelho onde alguém da equipe entrou, o totem rodaria com o cookie dela. Por isso só vale no desenvolvimento
// ou com VITE_ATALHO_CAMINHOS=1 no build (teste pelo IP); em produção, use os subdomínios.
export function noCaminho(caminho: string, pathname = typeof window !== 'undefined' ? window.location.pathname : ''): boolean {
  const env = readEnv();
  if (!env.DEV && env.VITE_ATALHO_CAMINHOS !== '1') return false;
  return pathname === caminho || pathname.startsWith(`${caminho}/`);
}

export function isAutoatendimentoHost(hostname = hostAtual()): boolean {
  return hostCorresponde(hostname, readEnv().VITE_AUTOATENDIMENTO_HOST, PREFIXO_TOTEM);
}

/** Painel de TV da recepção em subdomínio próprio (ex.: tv.suaempresa.com.br): abre direto na TV. */
export function isTvHost(hostname = hostAtual()): boolean {
  return hostCorresponde(hostname, readEnv().VITE_TV_HOST, PREFIXO_TV);
}

/** Endereço do totem para o botão da tela de login; vazio = abre o totem dentro do próprio portal (desenvolvimento). */
export function getAutoatendimentoUrl(): string | null {
  const env = readEnv();
  const url = env.VITE_AUTOATENDIMENTO_URL?.trim();
  if (!url) {
    // Em produção, abrir o totem dentro do portal deixa os dois na mesma origem: avisa quem implantou
    if (env.PROD) console.warn('[TOTEM] VITE_AUTOATENDIMENTO_URL não configurada: o totem abre dentro do portal, sem isolamento de sessão.');
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
  } catch {
    // cai no aviso abaixo
  }
  console.warn('[TOTEM] VITE_AUTOATENDIMENTO_URL inválida (use http:// ou https://): o totem abre dentro do portal.');
  return null;
}
