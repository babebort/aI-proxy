import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';

const OPENAI_PATHS = /^\/v1\/(chat\/completions|completions|models|responses|chat)/;

export function isOpenAiRoute(url: string): boolean {
  const path = url.split('?')[0] ?? '/';
  return OPENAI_PATHS.test(path) || path === '/';
}

export async function forwardToCodexer(
  req: IncomingMessage,
  res: ServerResponse,
  codexerPort: number,
): Promise<void> {
  const path = req.url ?? '/';
  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest(
      {
        method: req.method,
        hostname: '127.0.0.1',
        port: codexerPort,
        path,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        upstreamRes.on('end', resolve);
      },
    );
    upstream.on('error', reject);
    req.pipe(upstream);
  });
}
