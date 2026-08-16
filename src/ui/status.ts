import { loadAnthropicPool } from '../anthropic/config-loader.js';
import {
  loadConfig,
  loadCodexerAccounts,
  readCodexerGroupApi,
} from '../config.js';
import { probeHttp } from '../health.js';
import { readManaged } from '../process.js';
import { supervisorConfigPath } from '../paths.js';

function publicPort(config: Awaited<ReturnType<typeof loadConfig>>): number {
  return config.unified.enabled ? config.unified.port : config.anthropic.port;
}

export async function buildStatusPayload() {
  const config = await loadConfig();
  const unifiedProc = await readManaged('unified');
  const openaiProc = await readManaged('openai');
  const port = unifiedProc?.port ?? publicPort(config);
  const [unifiedHealth, codexerHealth] = await Promise.all([
    probeHttp(`http://127.0.0.1:${port}/health`),
    probeHttp(`http://127.0.0.1:${config.openai.port}/`),
  ]);

  let openaiAccounts: Awaited<ReturnType<typeof loadCodexerAccounts>> = [];
  try {
    openaiAccounts = await loadCodexerAccounts(config.openai.configFile);
  } catch {
    // no config yet
  }

  let anthropicAccounts: Array<{ name: string; disabled: boolean }> = [];
  try {
    const pool = await loadAnthropicPool(config.anthropic.configFile);
    anthropicAccounts = pool.accounts.map((a) => ({
      name: a.name,
      disabled: Boolean(a.disabled),
    }));
  } catch {
    // no config yet
  }

  const key =
    (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey ?? '';

  return {
    unified: {
      running: Boolean(unifiedProc),
      up: unifiedHealth.up,
      pid: unifiedProc?.pid ?? null,
      port,
      url: `http://127.0.0.1:${port}`,
    },
    codexer: {
      running: Boolean(openaiProc),
      up: codexerHealth.up,
      pid: openaiProc?.pid ?? null,
      port: config.openai.port,
      url: `http://127.0.0.1:${config.openai.port}`,
    },
    anthropic: {
      configFile: config.anthropic.configFile,
      accountCount: anthropicAccounts.length,
    },
    openaiAccounts,
    anthropicAccounts,
    env: {
      AI_PROXY_URL: `http://127.0.0.1:${port}`,
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      OPENAI_API_KEY: key,
      CODEXER_API_KEY: key,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    },
    configPath: supervisorConfigPath(),
  };
}
