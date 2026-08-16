import { createServer, type Server } from 'node:http';

export interface CallbackResult {
  code: string;
  state: string;
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI Proxy</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Готово</h1><p>Авторизация прошла успешно. Закрой эту вкладку и вернись в AI Proxy.</p></body></html>`;

export function waitForOAuthCallback(
  redirectUri: string,
  expectedState: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<CallbackResult> {
  const parsed = new URL(redirectUri);
  const callbackPath = parsed.pathname || '/';
  const host = parsed.hostname || '127.0.0.1';
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const addr = `${host}:${port}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      shutdown();
      reject(new Error('oauth callback timed out'));
    }, timeoutMs);

    let server: Server | null = null;

    const shutdown = () => {
      clearTimeout(timer);
      if (server) {
        server.close(() => {});
        server = null;
      }
    };

    const finish = (result: CallbackResult) => {
      if (settled) return;
      settled = true;
      shutdown();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      shutdown();
      reject(error);
    };

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${addr}`);
      if (url.pathname !== callbackPath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const errorParam = url.searchParams.get('error')?.trim();
      if (errorParam) {
        const desc = url.searchParams.get('error_description')?.trim();
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('authorization failed');
        fail(new Error(desc ? `oauth error: ${errorParam} (${desc})` : `oauth error: ${errorParam}`));
        return;
      }

      const code = url.searchParams.get('code')?.trim() ?? '';
      const state = url.searchParams.get('state')?.trim() ?? '';
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('missing code');
        return;
      }

      if (expectedState && state && state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('state mismatch');
        fail(new Error('oauth state mismatch'));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      finish({ code, state });
    });

    server.on('error', (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    server.listen(Number(port), host, () => {});
  });
}
