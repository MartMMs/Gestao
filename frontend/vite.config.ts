import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Content-Security-Policy do build de produção (no dev, o Vite injeta scripts inline e a política quebraria o HMR).
// Bloqueia scripts de terceiros/injetados e impede que o portal seja embutido em iframe (clickjacking).
const politicaDeSeguranca = (env: Record<string, string>): Plugin => {
  const origem = (url?: string) => {
    try { return url ? new URL(url).origin : ''; } catch { return ''; }
  };
  const api = [origem(env.VITE_API_URL), origem(env.VITE_SOCKET_URL)].filter(Boolean);
  const sockets = api.map((o) => o.replace(/^http/, 'ws'));
  // Sem URL configurada, a API fica na porta 3333 do mesmo host: libera qualquer host em http(s)/ws(s)
  const conexoes = api.length > 0 ? [...api, ...sockets] : ['http:', 'https:', 'ws:', 'wss:'];
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' https://assets.mixkit.co",
    `connect-src 'self' ${conexoes.join(' ')} https://api.open-meteo.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'politica-de-seguranca',
    apply: 'build',
    transformIndexHtml: (html) => html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    ),
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), 'VITE_');
  return {
    plugins: [react(), tailwindcss(), politicaDeSeguranca(env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@assets': path.resolve(__dirname, './src/assets'),
        // Regras compartilhadas com o backend
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Permite importar regras compartilhadas com o backend (../shared)
      fs: { allow: [path.resolve(__dirname, '..')] },
    },
  };
});
