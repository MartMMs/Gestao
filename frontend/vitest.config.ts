import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Os testes rodam no fuso do negócio: erros de data que só aparecem em -03 (dia da semana trocado) não passam batido
process.env.TZ = 'America/Sao_Paulo';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
