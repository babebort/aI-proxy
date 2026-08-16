import { DEFAULT_UI_PORT } from '../paths.js';
import { ensureProxyRunning } from '../proxy-lifecycle.js';
import { openUiWindow } from './open-window.js';
import { startUiServer } from './server.js';

export interface LaunchUiOptions {
  port?: number;
  open?: boolean;
  app?: boolean;
  autoProxy?: boolean;
  /** Start servers and exit (used by the macOS .app launcher via nohup). */
  detach?: boolean;
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
    // PWA in browser — user installs from Chrome/Safari; no forced chromeless window.
    openUiWindow(url, false);
  }

  if (options.detach) {
    return;
  }

  console.log(`AI-proxy  ${url}`);
  console.log('Ctrl+C closes the panel. Proxy :8787 keeps running in background.');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
      setTimeout(resolve, 1500).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
