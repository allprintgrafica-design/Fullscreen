import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';

// Resolve the application from this file, never from the caller's working directory.
const root = fileURLToPath(new URL('../', import.meta.url));
const prepareOnly = process.argv.includes('--prepare-only');
const windows = process.platform === 'win32';
const environment = {
  ...process.env,
  NODE_ENV: 'development',
  DATA_DIR: path.join(root, 'data'),
  PORT: '3001',
  APP_ORIGIN: 'http://localhost:5173',
  API_PROXY_TARGET: 'http://127.0.0.1:3001',
};
const children = new Set();

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once('error', (error) =>
      reject(
        new Error(
          'El puerto ' +
            port +
            ' no esta disponible (' +
            error.code +
            '). Revisa si ya tienes otra ventana de la aplicacion abierta.',
        ),
      ),
    );
    server.listen(port, '0.0.0.0', () => server.close(resolve));
  });
}

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (windows) {
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Only processes started by this launcher are targeted. */
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) stopChild(child);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

function npm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      windows ? 'cmd.exe' : 'npm',
      windows ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args,
      { cwd: root, env: environment, stdio: 'inherit', detached: !windows },
    );
    children.add(child);
    child.once('error', (error) => {
      children.delete(child);
      reject(new Error('No se pudo ejecutar npm: ' + error.message));
    });
    child.once('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            'npm ' +
              args.join(' ') +
              ' termino con ' +
              (signal || code) +
              '. Revisa el mensaje anterior.',
          ),
        );
    });
  });
}

async function openWhenReady(signal) {
  const deadline = Date.now() + 60_000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
      const health = await fetch('http://127.0.0.1:3001/api/health', { signal: requestSignal });
      const status = await health.json();
      const frontend = await fetch('http://localhost:5173', { signal: requestSignal });
      const html = await frontend.text();
      if (
        health.ok &&
        status.status === 'ok' &&
        status.database === true &&
        frontend.ok &&
        html.includes('<title>Fullscreen')
      ) {
        console.log('\nFullscreen esta disponible en http://localhost:5173');
        console.log('Manten esta ventana abierta mientras uses la aplicacion.\n');
        if (windows) {
          const browser = spawn(
            'powershell.exe',
            ['-NoProfile', '-Command', "Start-Process 'http://localhost:5173'"],
            { stdio: 'ignore', windowsHide: true },
          );
          browser.on('error', () => console.log('Abre http://localhost:5173 en tu navegador.'));
        }
        return;
      }
    } catch {
      /* Startup can take several seconds; keep the actual server logs visible. */
    }
    try {
      await delay(1000, undefined, { signal });
    } catch {
      return;
    }
  }
  if (!signal.aborted)
    console.log('El servidor tarda en iniciar. Revisa los mensajes de esta ventana.');
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Se necesita Node.js 24 o superior.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'fullscreen-signage' || !manifest.scripts?.seed || !manifest.scripts?.dev) {
    throw new Error(
      'Esta carpeta no contiene el proyecto Fullscreen correcto. Extrae el ZIP completo.',
    );
  }
  console.log('FULLSCREEN - Demo local\nCarpeta del proyecto: ' + root + '\n');
  const probe = spawnSync('ffprobe', ['-version'], {
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (probe.status !== 0)
    console.log(
      'FFprobe no esta disponible. Las imagenes funcionan; los videos requieren FFmpeg en el PATH.\n',
    );

  const lock = fs.readFileSync(path.join(root, 'package-lock.json'));
  const fingerprint = [
    process.platform,
    process.arch,
    process.versions.node.split('.')[0],
    createHash('sha256').update(lock).digest('hex'),
  ].join(':');
  const stamp = path.join(root, 'node_modules', '.fullscreen-local-lock');
  const previousStamp = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
  if (
    previousStamp !== fingerprint ||
    !fs.existsSync(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'))
  ) {
    console.log('Instalando dependencias de Fullscreen. Puede tardar unos minutos.\n');
    await npm(['ci', '--include=dev']);
    fs.writeFileSync(stamp, fingerprint);
  } else console.log('Las dependencias de Fullscreen ya estan instaladas.\n');

  console.log('Preparando la demostracion local. Los datos existentes se conservan.\n');
  await npm(['run', 'seed']);
  if (prepareOnly) console.log('Preparacion completada.');
  else {
    await assertPortFree(3001);
    await assertPortFree(5173);
    console.log('Iniciando Fullscreen. Manten esta ventana abierta.\n');
    const ready = new AbortController();
    const readiness = openWhenReady(ready.signal);
    try {
      await npm(['run', 'dev']);
    } finally {
      ready.abort();
      await readiness;
    }
  }
} catch (error) {
  console.error('\n' + error.message);
  for (const child of children) stopChild(child);
  process.exitCode = 1;
}
