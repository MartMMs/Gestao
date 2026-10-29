// O totem de autoatendimento roda num subdomínio próprio (ex.: autoatendimento.suaempresa.com.br).
// Nele só existe o fluxo público: sem login e sem acesso ao portal da equipe. Como o localStorage é por origem,
// a sessão da equipe nunca fica acessível no aparelho do totem.
// Importante: o isolamento da sessão depende de o totem estar num SUBDOMÍNIO (outra origem).
// Servir o totem num caminho do mesmo host (app.x.com/autoatendimento) não separa o localStorage.
import { readEnv } from './env';

const PREFIXO_PADRAO = 'autoatendimento.';

export function isAutoatendimentoHost(hostname = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
  const host = hostname.toLowerCase();
  if (!host) return false;
  // Aceita vários hosts separados por vírgula (ex.: "totem.x.com,www.totem.x.com")
  const configurados = (readEnv().VITE_AUTOATENDIMENTO_HOST || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (configurados.length > 0) return configurados.includes(host);
  return host.startsWith(PREFIXO_PADRAO);
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
