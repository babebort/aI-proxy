import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { loadAccountManager } from './account-manager.js';
import { RETRY_STATUS } from './types.js';
import { extractSessionKey } from './session.js';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export async function handleAnthropicProxy(
  req: IncomingMessage,
  res: ServerResponse,
  configFile: string,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'method not allowed' } }));
    return;
  }

  const manager = await loadAccountManager(configFile);
  if (manager.size() === 0) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'no anthropic accounts configured' } }));
    return;
  }

  const body = await readBody(req);
  const path = normalizeAnthropicPath(req.url ?? '/');
  const sessionKey = extractSessionKey(body);
  const poolConfig = manager.config;
  let skipName: string | undefined;
  const attempts = Math.min(manager.size(), 4);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const account = manager.select(sessionKey, skipName);
    if (!account) {
      break;
    }
    skipName = account.name;

    const token = await manager.accessTokenFor(account);
    if (!token) {
      continue;
    }

    const upstream = await forwardOnce(poolConfig.upstream, path, req.headers, body, token);

    manager.updateQuotaFromResponse(account.name, upstream.headers);
    if (upstream.status === 429) {
      manager.markRateLimited(account.name, parseRetryAfter(upstream.headers));
    } else if (upstream.status >= 200 && upstream.status < 300) {
      manager.clearRateLimited(account.name);
      manager.pinSession(sessionKey, account.name);
    }

    if (!RETRY_STATUS.has(upstream.status) || attempt === attempts - 1) {
      writeUpstreamResponse(res, upstream);
      return;
    }
  }

  res.writeHead(502, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'all anthropic accounts rejected the request' } }));
}

function parseRetryAfter(headers: Record<string, string | string[]>): number {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return 60;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) ? seconds : 60;
}

function normalizeAnthropicPath(url: string): string {
  const parsed = new URL(url, 'http://127.0.0.1');
  let path = parsed.pathname;
  if (path.startsWith('/api/v1/')) {
    path = path.slice(4);
  }
  return path + parsed.search;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

interface UpstreamResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

async function forwardOnce(
  upstreamBase: string,
  path: string,
  incomingHeaders: IncomingMessage['headers'],
  body: Buffer,
  token: string,
): Promise<UpstreamResult> {
  const target = new URL(path, upstreamBase.endsWith('/') ? upstreamBase : `${upstreamBase}/`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-api-key') {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  headers.authorization = `Bearer ${token}`;
  headers['content-length'] = String(body.length);

  return new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstreamReq = lib(
      {
        method: 'POST',
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        headers,
      },
      (upstreamRes) => {
        const outHeaders: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(upstreamRes.headers)) {
          if (v !== undefined) {
            outHeaders[k] = v;
          }
        }
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () =>
          resolve({
            status: upstreamRes.statusCode ?? 502,
            headers: outHeaders,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    upstreamReq.on('error', reject);
    upstreamReq.write(body);
    upstreamReq.end();
  });
}

function writeUpstreamResponse(res: ServerResponse, upstream: UpstreamResult): void {
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    if (value !== undefined) {
      res.setHeader(key, value);
    }
  }
  res.writeHead(upstream.status);
  res.end(upstream.body);
}
