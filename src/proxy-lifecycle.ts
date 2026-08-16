import { fileURLToPath } from 'node:url';
import { ensureAnthropicConfig, ensureConfig, loadConfig } from './config.js';
import { waitForUp } from './health.js';
import { readManaged, startUnifiedDaemon } from './process.js';

const daemonScript = fileURLToPath(new URL('./server/daemon.js', import.meta.url));

export function publicPort(config: Awaited<ReturnType<typeof loadConfig>>): number {
  return config.unified.enabled ? config.unified.port : config.anthropic.port;
}

export async function ensureProxyRunning(): Promise<void> {
  const existing = await readManaged('unified');
  if (existing) {
    return;
  }
  const config = await ensureConfig();
  await ensureAnthropicConfig(config.anthropic.configFile, config.anthropic.apiKey);
  const port = publicPort(config);
  await startUnifiedDaemon(daemonScript, port);
  const up = await waitForUp(`http://127.0.0.1:${port}/health`, 30, 500);
  if (!up) {
    console.warn(`Warning: unified proxy did not respond on :${port} yet`);
  }
}
