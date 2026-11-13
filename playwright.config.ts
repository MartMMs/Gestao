import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Carrega E2E_PASSWORD e demais variáveis do .env local (no CI elas vêm do ambiente)
dotenv.config({ quiet: true });

if (!process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE) {
  process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = 'ubuntu24.04-x64';
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

/**
 * E2E assume API em PLAYWRIGHT_API_URL (default :3333) e UI em baseURL (:3000).
 * Local: `npm run dev:all` ou defina PLAYWRIGHT_SKIP_WEBSERVER=1 com stack ja no ar.
 */
export default defineConfig({
  testDir: './e2e',
  // Desliga a chave global de anamnese no início (ver e2e/global-setup.ts)
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 25_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /\.global\.spec\.ts$/ },
    // Specs que mudam configuração global da empresa (ex.: exigir anamnese) rodam sozinhas, depois de todas as outras:
    // em paralelo, a chave ligada faria os agendamentos dos outros testes falharem. Atenção: se algum teste do projeto
    // chromium falhar, este projeto é pulado (aparece como "did not run"); para rodá-lo sozinho depois de corrigir:
    // npm run test:e2e:global (usa --no-deps)
    { name: 'configuracao-global', use: { ...devices['Desktop Chrome'] }, testMatch: /\.global\.spec\.ts$/, dependencies: ['chromium'], fullyParallel: false,
      // Um arquivo por vez: fullyParallel só ordena os testes de um arquivo, e os dois specs globais ligam/desligam a mesma chave
      workers: 1 },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev:all',
        url: baseURL,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
});
