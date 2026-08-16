#!/usr/bin/env node
/** Background daemon: codexer (internal) + unified HTTP server (public). */
import { ensureAnthropicConfig, ensureConfig } from '../config.js';
import { resolveCodexer } from '../binaries.js';
import { waitForUp } from '../health.js';
import { startCodexer, stopManaged, writePidFile } from '../process.js';
import { startUnifiedServer } from './unified.js';

async function shutdown(): Promise<void> {
  await stopManaged('openai');
  process.exit(0);
}

async function main(): Promise<void> {
  const config = await ensureConfig();
  await ensureAnthropicConfig(config.anthropic.configFile, config.anthropic.apiKey);

  const codexer = await resolveCodexer();
  await startCodexer(codexer, config.openai, { foreground: false });

  const codexerUp = await waitForUp(`http://127.0.0.1:${config.openai.port}/`);
  if (!codexerUp) {
    throw new Error(`codexer did not start on :${config.openai.port}`);
  }

  const publicPort = config.unified.enabled ? config.unified.port : config.anthropic.port;
  startUnifiedServer({
    port: publicPort,
    anthropicConfigFile: config.anthropic.configFile,
    codexerInternalPort: config.openai.port,
  });

  await writePidFile('unified', process.pid, publicPort);
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
