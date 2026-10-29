#!/usr/bin/env node
/**
 * Regressao local pre-release: lint, unitarios, build, smoke LGPD, E2E.
 * Inicia a API automaticamente se a porta 3333 nao estiver ativa.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

function canConnect(port = 3333, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    s.setTimeout(500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => { resolve(false); });
  });
}

async function waitForPort(port = 3333, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await canConnect(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let apiChild = null;

function cleanup() {
  if (apiChild && !apiChild.killed) {
    apiChild.kill('SIGTERM');
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

function run(label, cmd, args) {
  console.log(`\n[test:regression] ${label}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    cleanup();
    process.exit(r.status ?? 1);
  }
}

async function main() {
  run('lint', 'npm', ['run', 'lint']);
  run('unit (Vitest)', 'npm', ['run', 'test:unit']);
  run('build', 'npm', ['run', 'build']);

  const apiRunning = await canConnect(3333);
  if (!apiRunning) {
    console.log('\n[test:regression] API nao detectada na porta 3333. Iniciando API para smoke LGPD...');
    apiChild = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'backend/server.ts'], {
      stdio: 'ignore',
      shell: false,
    });
    const ready = await waitForPort(3333);
    if (!ready) {
      console.error('[test:regression] Falha ao iniciar API na porta 3333.');
      cleanup();
      process.exit(1);
    }
    console.log('[test:regression] API pronta na porta 3333.');
  }

  run('smoke LGPD', 'npm', ['run', 'smoke:lgpd']);

  if (process.env.SKIP_E2E === '1') {
    console.log('\n[test:regression] SKIP_E2E=1 — Playwright ignorado.\n');
    cleanup();
    process.exit(0);
  }

  run('e2e (Playwright)', 'npx', ['playwright', 'test']);
  cleanup();
  console.log('\n[test:regression] concluido com sucesso.\n');
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});

