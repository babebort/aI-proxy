import { createServer, type Server } from 'node:http';
import { handleAnthropicProxy } from '../anthropic/proxy.js';
import { forwardToCodexer, isOpenAiRoute } from '../openai/forward.js';

export interface UnifiedServerOptions {
  port: number;
  anthropicConfigFile: string;
  codexerInternalPort: number;
}

export function startUnifiedServer(options: UnifiedServerOptions): Server {
  const state = { anthropicConfigFile: options.anthropicConfigFile };

  const server = createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';

      if (url === '/health' || url === '/_ai-proxy/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, mode: 'unified' }));
        return;
      }

      if (url.startsWith('/v1/messages') || url.startsWith('/api/v1/messages')) {
        await handleAnthropicProxy(req, res, state.anthropicConfigFile);
        return;
      }

      if (isOpenAiRoute(url)) {
        await forwardToCodexer(req, res, options.codexerInternalPort);
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'unknown route — use /v1/messages or /v1/chat/completions' },
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: { message } }));
    }
  });

  server.listen(options.port, '127.0.0.1');
  return server;
}
