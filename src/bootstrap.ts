#!/usr/bin/env node
/** Spawn AI-proxy UI in background; parent exits immediately. */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UI_PORT, logDir } from './paths.js';
import { writePidFile } from './process.js';

const distDir = path.dirname(fileURLToPath(import.meta.url));
const mainJs = path.join(distDir, 'main.js');

async function uiIsUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function portFromArgs(): number {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--port=')) {
      const n = Number(arg.slice('--port='.length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return DEFAULT_UI_PORT;
}

async function main(): Promise<void> {
  const port = portFromArgs();
  const url = `http://127.0.0.1:${port}`;
  const noOpen = process.argv.includes('--no-open');

  if (await uiIsUp(port)) {
    console.log(`AI-proxy already running  ${url}`);
    if (!noOpen) {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    return;
  }

  await mkdir(logDir(), { recursive: true, mode: 0o700 });
  const logFile = path.join(logDir(), 'ui.log');
  const logFd = openSync(logFile, 'a');

  const childArgs = [`--port=${port}`, '--background-child'];
  if (noOpen) childArgs.push('--no-open');

  const child = spawn(process.execPath, [mainJs, ...childArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });

  if (!child.pid) {
    throw new Error('failed to spawn AI-proxy UI');
  }

  child.unref();

  for (let i = 0; i < 40; i += 1) {
    if (await uiIsUp(port)) {
      await writePidFile('ui', child.pid, port);
      console.log(`AI-proxy  ${url}  (background pid ${child.pid})`);
      console.log(`logs: ${logFile}`);
      console.log('npm run stop — закрыть UI · npm run stop -- --all — UI + proxy');
      if (!noOpen) {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`UI did not start on ${url} — see ${logFile}`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
