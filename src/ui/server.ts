import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureConfig } from '../config.js';
import { waitForUp } from '../health.js';
import { readManaged, startUnifiedDaemon, stopManaged } from '../process.js';
import { publicPort } from '../proxy-lifecycle.js';
import { uiDir } from '../paths.js';
import { buildStatusPayload } from './status.js';
import { probeAccountsPayload } from './probes.js';
import { openAnthropicLoginTerminal, openAnthropicReauthTerminal, openOpenAiLoginTerminal, openOpenAiReauthTerminal } from './login.js';
import { removeAnthropicAccount, removeCodexerUser } from './account-store.js';

const daemonScript = fileURLToPath(new URL('../server/daemon.js', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(urlPath: string, res: ServerResponse): Promise<boolean> {
  const safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(uiDir(), safe === '/' || safe === '' ? 'index.html' : safe);
  if (!filePath.startsWith(uiDir())) {
    return false;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/status') {
    json(res, 200, await buildStatusPayload());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/accounts/probe') {
    const raw = await readBody(req);
    let body: { provider?: string; id?: string } = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw) as { provider?: string; id?: string };
      } catch {
        json(res, 400, { error: 'invalid json body' });
        return true;
      }
    }
    const provider =
      body.provider === 'openai' || body.provider === 'anthropic' ? body.provider : undefined;
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    if ((provider && !id) || (!provider && id)) {
      json(res, 400, { error: 'provider and id must be sent together' });
      return true;
    }
    json(
      res,
      200,
      await probeAccountsPayload(provider && id ? { provider, id } : undefined),
    );
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/proxy/start') {
    const config = await ensureConfig();
    const existing = await readManaged('unified');
    if (existing) {
      json(res, 200, { ok: true, alreadyRunning: true, pid: existing.pid, port: existing.port });
      return true;
    }
    const port = publicPort(config);
    const proc = await startUnifiedDaemon(daemonScript, port);
    const up = await waitForUp(`http://127.0.0.1:${port}/health`, 30, 500);
    json(res, up ? 200 : 503, { ok: up, pid: proc.pid, port: proc.port });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/proxy/stop') {
    const stoppedUnified = await stopManaged('unified');
    const stoppedOpenai = await stopManaged('openai');
    json(res, 200, { ok: true, stoppedUnified, stoppedOpenai });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/login/openai') {
    try {
      const opened = await openOpenAiLoginTerminal();
      json(res, 200, { ok: opened, terminal: opened });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/login/anthropic') {
    try {
      const opened = await openAnthropicLoginTerminal();
      json(res, 200, { ok: opened, terminal: opened });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/accounts/reauth') {
    const raw = await readBody(req);
    let body: { provider?: string; id?: string; alias?: string } = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw) as { provider?: string; id?: string; alias?: string };
      } catch {
        json(res, 400, { error: 'invalid json body' });
        return true;
      }
    }
    const provider = body.provider === 'openai' || body.provider === 'anthropic' ? body.provider : null;
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
    if (!provider || !id) {
      json(res, 400, { error: 'provider and id are required' });
      return true;
    }
    try {
      const config = await ensureConfig();
      if (provider === 'openai') {
        const removed = await removeCodexerUser(config.openai.configFile, id);
        const alias = typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : id;
        const opened = await openOpenAiReauthTerminal(alias);
        json(res, 200, { ok: opened, terminal: opened, removed, alias });
        return true;
      }
      const removed = await removeAnthropicAccount(config.anthropic.configFile, id);
      const opened = await openAnthropicReauthTerminal(id);
      json(res, 200, { ok: opened, terminal: opened, removed, name: id });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    await readBody(req);
    json(res, 404, { error: 'unknown api route' });
    return true;
  }

  return false;
}

export function startUiServer(port: number): Server {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (await handleApi(req, res, url)) {
        return;
      }
      const served = await serveStatic(url.pathname, res);
      if (served) {
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  });

  server.listen(port, '127.0.0.1');
  return server;
}
