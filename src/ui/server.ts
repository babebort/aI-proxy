import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureConfig, loadConfig, saveConfig } from '../config.js';
import { waitForUp } from '../health.js';
import { readManaged, startUnifiedDaemon, stopManaged } from '../process.js';
import { publicPort } from '../proxy-lifecycle.js';
import { uiDir } from '../paths.js';
import { buildStatusPayload } from './status.js';
import { probeAccountsPayload } from './probes.js';
import { openAnthropicLoginTerminal, openAnthropicReauthTerminal } from './login.js';
import { removeAnthropicAccount } from './account-store.js';
import {
  beginOpenAiLogin,
  beginOpenAiReauth,
  getOpenAiLoginSession,
  listOpenAiLoginGroups,
  submitOpenAiLoginCode,
} from './openai-login-flow.js';
import { buildSettingsPayload } from './settings-api.js';
import { supervisorConfigPath } from '../paths.js';
import type { AnthropicProbeReasoning, SupervisorConfig } from '../config.js';

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
    const headers: Record<string, string> = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
    };
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['cache-control'] = 'no-store';
    }
    res.writeHead(200, headers);
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

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    const config = await ensureConfig();
    json(res, 200, buildSettingsPayload(config, supervisorConfigPath()));
    return true;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/settings') {
    try {
      const raw = await readBody(req);
      let body: {
        smspoolApiKey?: string | null;
        anthropicProbeModel?: string;
        anthropicProbeReasoning?: AnthropicProbeReasoning;
      } = {};
      if (raw.trim()) {
        body = JSON.parse(raw) as typeof body;
      }
      const config = await loadConfig();
      const next: SupervisorConfig = {
        ...config,
        anthropic: { ...config.anthropic },
        integrations: { ...config.integrations, smspool: { ...config.integrations?.smspool } },
      };

      if ('smspoolApiKey' in body) {
        const key = typeof body.smspoolApiKey === 'string' ? body.smspoolApiKey.trim() : '';
        next.integrations = {
          ...next.integrations,
          smspool: { apiKey: key || null },
        };
      }
      if (typeof body.anthropicProbeModel === 'string' && body.anthropicProbeModel.trim()) {
        next.anthropic.probeModel = body.anthropicProbeModel.trim();
      }
      if (body.anthropicProbeReasoning) {
        const allowed: AnthropicProbeReasoning[] = ['off', 'low', 'medium', 'high'];
        if (allowed.includes(body.anthropicProbeReasoning)) {
          next.anthropic.probeReasoning = body.anthropicProbeReasoning;
        }
      }

      await saveConfig(next);
      json(res, 200, buildSettingsPayload(next, supervisorConfigPath()));
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/login/openai/groups') {
    try {
      json(res, 200, { groups: await listOpenAiLoginGroups() });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/login/openai/status/')) {
    const sessionId = url.pathname.slice('/api/login/openai/status/'.length);
    const session = getOpenAiLoginSession(sessionId);
    if (!session) {
      json(res, 404, { error: 'login session not found or expired' });
      return true;
    }
    json(res, 200, {
      status: session.status,
      authUrl: session.authUrl,
      alias: session.alias,
      error: session.error,
      account: session.account,
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/login/openai/begin') {
    try {
      const raw = await readBody(req);
      let body: { alias?: string; gid?: string; newGroupName?: string } = {};
      if (raw.trim()) {
        body = JSON.parse(raw) as typeof body;
      }
      const alias = typeof body.alias === 'string' ? body.alias : '';
      const gid = typeof body.gid === 'string' ? body.gid : undefined;
      const newGroupName = typeof body.newGroupName === 'string' ? body.newGroupName : undefined;
      const result = await beginOpenAiLogin({ alias, gid, newGroupName });
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/login/openai/submit') {
    try {
      const raw = await readBody(req);
      let body: { sessionId?: string; code?: string } = {};
      if (raw.trim()) {
        body = JSON.parse(raw) as typeof body;
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      const code = typeof body.code === 'string' ? body.code : '';
      if (!sessionId || !code) {
        json(res, 400, { error: 'sessionId and code are required' });
        return true;
      }
      const session = await submitOpenAiLoginCode(sessionId, code);
      json(res, 200, {
        status: session.status,
        account: session.account,
        error: session.error,
      });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/login/openai') {
    json(res, 200, {
      staleUi: true,
      inApp: true,
      error:
        'Старый UI в кеше. Обнови страницу: Cmd+Shift+R (или DevTools → Application → Unregister service worker).',
    });
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
        const alias =
          typeof body.alias === 'string' && body.alias.trim() ? body.alias.trim() : id;
        const account = (await buildStatusPayload()).openaiAccounts.find(
          (row) => row.uuid === id || row.alias === id,
        );
        if (!account?.gid) {
          json(res, 400, { error: 'account group not found' });
          return true;
        }
        const result = await beginOpenAiReauth({
          uuid: account.uuid || id,
          alias,
          gid: account.gid,
        });
        json(res, 200, { ok: true, inApp: true, ...result, alias });
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
