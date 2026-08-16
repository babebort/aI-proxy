#!/usr/bin/env node
/** Stop AI-proxy UI (:8790) and optional proxy (:8787). */
import { DEFAULT_UI_PORT } from './paths.js';
import { readManaged, stopManaged } from './process.js';

async function killPort(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const stopProxy = process.argv.includes('--all');
  let stopped = false;

  if (stopProxy) {
    stopped = (await stopManaged('unified')) || (await stopManaged('openai')) || stopped;
    await killPort(DEFAULT_UI_PORT);
  }

  const { execSync } = await import('node:child_process');
  for (const port of stopProxy ? [DEFAULT_UI_PORT, 8787, 9090] : [DEFAULT_UI_PORT]) {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim();
      for (const pid of out.split('\n').filter(Boolean)) {
        try {
          process.kill(Number(pid), 'SIGTERM');
          stopped = true;
          console.log(`stopped pid ${pid} (:${port})`);
        } catch {
          // already gone
        }
      }
    } catch {
      // nothing listening
    }
  }

  if (!stopped) {
    console.log(stopProxy ? 'nothing running' : 'UI not running');
  }
}

await main();
