import { DEFAULT_UI_PORT } from '../paths.js';
import { ensureProxyRunning } from '../proxy-lifecycle.js';
import { writePidFile } from '../process.js';
import { openUiWindow } from './open-window.js';
import { startUiServer } from './server.js';

export interface LaunchUiOptions {
  port?: number;
  open?: boolean;
  app?: boolean;
  autoProxy?: boolean;
  /** Legacy: exit without waiting (server dies unless spawned detached). */
  detach?: boolean;
  /** Spawned by bootstrap.ts — keep running, no Ctrl+C wait. */
  backgroundChild?: boolean;
  /** Block terminal until Ctrl+C (npm run start:fg). */
  foreground?: boolean;
  /** Only open the panel if the UI server is already up. */
  openOnly?: boolean;
}

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

export async function launchUi(options: LaunchUiOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_UI_PORT;
  const open = options.open !== false;
  const autoProxy = options.autoProxy !== false;
  const url = `http://127.0.0.1:${port}`;

  if (options.openOnly) {
    if (await uiIsUp(port)) {
      if (open) openUiWindow(url, false);
      return;
    }
    throw new Error(`AI Proxy UI is not running on ${url}`);
  }

  if (await uiIsUp(port)) {
    if (open) openUiWindow(url, false);
    if (!options.detach) {
      console.log(`AI-proxy already running  ${url}`);
    }
    return;
  }

  if (autoProxy) {
    await ensureProxyRunning();
  }

  const server = startUiServer(port);
  if (open) {
    openUiWindow(url, false);
  }

  await writePidFile('ui', process.pid, port).catch(() => undefined);

  if (options.backgroundChild || options.detach) {
    return;
  }

  console.log(`AI-proxy  ${url}`);
  console.log('Ctrl+C closes the panel. npm run stop — закрыть UI.');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
      setTimeout(resolve, 1500).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
