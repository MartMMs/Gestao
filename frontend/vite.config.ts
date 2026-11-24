import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), 'VITE_');
  return {
    // CSP: fonte única no nginx (docs/nginx-https.conf.example), por cabeçalho; o build não leva <meta> de CSP
    plugins: [react(), tailwindcss()],
    // Sem mapas do código-fonte em produção: o código do portal não fica legível para quem abre o totem
    build: { sourcemap: false },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@assets': path.resolve(__dirname, './src/assets'),
        // Regras compartilhadas com o backend
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    // vite preview atrás do Cloudflare Tunnel (scripts/apresentacao.sh): aceita só os hosts configurados e manda
    // os mesmos cabeçalhos de segurança do nginx de produção (CSP em Report-Only, como lá)
    preview: {
      headers: {
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': 'max-age=31536000',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' https://assets.mixkit.co; connect-src 'self' wss: https://api.open-meteo.com https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      },
      allowedHosts: [env.VITE_AUTOATENDIMENTO_HOST, env.VITE_PAINEL_HOST, env.VITE_TV_HOST].flatMap((h) => (h ?? '').split(',').map((x) => x.trim()).filter(Boolean)),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Permite importar regras compartilhadas com o backend (../shared)
      fs: { allow: [path.resolve(__dirname, '..')] },
    },
  };
});
