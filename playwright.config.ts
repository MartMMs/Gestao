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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev:all',
        url: baseURL,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
});
