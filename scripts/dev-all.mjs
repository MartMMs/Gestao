import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const children = [];

function prefixStream(stream, prefix, isError = false) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const output = `${prefix} ${line}`;
      if (isError) {
        console.error(output);
      } else {
        console.log(output);
      }
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      const output = `${prefix} ${buffer}`;
      if (isError) {
        console.error(output);
      } else {
        console.log(output);
      }
    }
  });
}

function run(name, command, args, options = {}) {
  const isCritical = options.critical ?? true;
  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    detached: process.platform !== 'win32',
    env: process.env,
  });

  children.push(child);

  prefixStream(child.stdout, `[${name}]`);
  prefixStream(child.stderr, `[${name}]`, true);

  child.on('exit', (code, signal) => {
    const status = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[${name}] process ended with ${status}`);

    if (!shuttingDown && code && code !== 0) {
      if (isCritical) {
        console.error(`[launcher] ${name} failed, stopping all processes...`);
        shutdown(1);
        return;
      }

      console.error(`[launcher] ${name} failed, keeping remaining processes alive for investigation.`);
    }
  });

  child.on('error', (error) => {
    console.error(`[launcher] failed to start ${name}:`, error.message);
    if (!shuttingDown) {
      if (isCritical) {
        shutdown(1);
      }
    }
  });

  return child;
}

function isPortInUse(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        resolve(true);
        return;
      }
      resolve(true);
    });

    server.once('listening', () => {
      server.close(() => resolve(false));
    });

    server.listen(port, host);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnectToPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPortOpen(port, options = {}) {
  const host = options.host || '127.0.0.1';
  const timeoutMs = options.timeoutMs || 45_000;
  const pollMs = options.pollMs || 300;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const open = await canConnectToPort(port, host);
    if (open) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }

  return false;
}

let shuttingDown = false;

function killChildTree(child, signal) {
  if (!child || child.exitCode !== null) return;
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // fallback to direct child.kill below
    }
  }
  try {
    child.kill(signal);
  } catch {
    // ignore if already exited
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    killChildTree(child, 'SIGTERM');
  }

  setTimeout(() => {
    for (const child of children) {
      killChildTree(child, 'SIGKILL');
    }
    process.exit(exitCode);
  }, 1000);
}

process.on('SIGINT', () => {
  console.log('\n[launcher] stopping services...');
  shutdown(0);
});

process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('[launcher] starting frontend and backend...');
  const frontendDir = existsSync(path.resolve(process.cwd(), 'frontend/package.json')) ? 'frontend' : '.';
  const backendDir = existsSync(path.resolve(process.cwd(), 'backend/server.ts')) ? 'backend' : '.';
  const backendHasPackage = existsSync(path.resolve(process.cwd(), 'backend/package.json'));
  const apiPort = Number(process.env.PORT || 3333);

  const apiInUse = await isPortInUse(apiPort, '0.0.0.0');
  if (apiInUse) {
    console.log(`[launcher] API port ${apiPort} already in use. Keeping existing API instance.`);
    run('FRONT', 'npm', ['run', 'dev'], { cwd: path.resolve(process.cwd(), frontendDir), critical: true });
    return;
  }

  if (backendHasPackage) {
    run('API', 'npm', ['run', 'dev'], { cwd: path.resolve(process.cwd(), backendDir), critical: false });
    console.log(`[launcher] waiting API on port ${apiPort}...`);
    const apiReady = await waitForPortOpen(apiPort);
    if (!apiReady) {
      console.error(`[launcher] API did not open port ${apiPort} within timeout.`);
      shutdown(1);
      return;
    }
    console.log(`[launcher] API is ready on port ${apiPort}. Starting frontend...`);
    run('FRONT', 'npm', ['run', 'dev'], { cwd: path.resolve(process.cwd(), frontendDir), critical: true });
    return;
  }

  run('API', 'npx', ['tsx', 'server.ts'], { cwd: path.resolve(process.cwd(), backendDir), critical: false });
  console.log(`[launcher] waiting API on port ${apiPort}...`);
  const apiReady = await waitForPortOpen(apiPort);
  if (!apiReady) {
    console.error(`[launcher] API did not open port ${apiPort} within timeout.`);
    shutdown(1);
    return;
  }
  console.log(`[launcher] API is ready on port ${apiPort}. Starting frontend...`);
  run('FRONT', 'npm', ['run', 'dev'], { cwd: path.resolve(process.cwd(), frontendDir), critical: true });
}

main().catch((error) => {
  console.error('[launcher] startup failed:', error?.message || error);
  shutdown(1);
});
