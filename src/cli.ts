#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAnthropicPool } from './anthropic/config-loader.js';
import {
  ensureAnthropicConfig,
  ensureConfig,
  loadConfig,
  readCodexerGroupApi,
  loadCodexerAccounts,
} from './config.js';
import { resolveCodexer, resolveTeamclaude } from './binaries.js';
import { probeHttp, waitForUp } from './health.js';
import {
  readManaged,
  runInteractive,
  startCodexer,
  startAnthropic,
  startUnifiedDaemon,
  stopManaged,
} from './process.js';
import { defaultCodexerConfig, supervisorConfigPath } from './paths.js';
import { startUnifiedServer } from './server/unified.js';

const daemonScript = fileURLToPath(new URL('./server/daemon.js', import.meta.url));

const program = new Command();

program
  .name('ai-proxy')
  .description('Unified local proxy: OpenAI (codexer) + Anthropic (native pool) on one port')
  .version('0.3.0');

program
  .command('start')
  .description('Start unified server (:8787) + internal codexer (:9090)')
  .option('-f, --foreground', 'Run unified server in foreground (codexer still background)')
  .option('--legacy', 'Use separate ports + teamclaude-rs instead of unified server')
  .action(async (opts: { foreground?: boolean; legacy?: boolean }) => {
    const config = await ensureConfig();
    await ensureAnthropicConfig(config.anthropic.configFile, config.anthropic.apiKey);

    if (opts.legacy) {
      await startLegacy(config, opts.foreground ?? false);
      return;
    }

    if (opts.foreground) {
      await startForegroundUnified(config);
      return;
    }

    await startUnifiedDaemon(daemonScript, publicPort(config));
    const up = await waitForUp(`http://127.0.0.1:${publicPort(config)}/health`);
    printStatus(config, up);
  });

program
  .command('stop')
  .description('Stop ai-proxy')
  .action(async () => {
    const stoppedUnified = await stopManaged('unified');
    const stoppedOpenai = await stopManaged('openai');
    const stoppedAnthropic = await stopManaged('anthropic');
    if (!stoppedUnified && !stoppedOpenai && !stoppedAnthropic) {
      console.log('Nothing running.');
      return;
    }
    console.log(
      `Stopped:${stoppedUnified ? ' unified' : ''}${stoppedOpenai ? ' openai' : ''}${stoppedAnthropic ? ' anthropic' : ''}`,
    );
  });

program
  .command('status')
  .description('Show proxy health and client env hints')
  .action(async () => {
    const config = await loadConfig();
    const unifiedProc = await readManaged('unified');
    const port = unifiedProc?.port ?? publicPort(config);
    const up = (await probeHttp(`http://127.0.0.1:${port}/health`)).up;
    const openaiProc = await readManaged('openai');
    printStatus(config, up, unifiedProc, openaiProc);
  });

const openaiCmd = program.command('openai').description('OpenAI / Codex (codexer)');

openaiCmd
  .command('login')
  .description('Add or refresh a ChatGPT OAuth account (codexer auth)')
  .action(async () => {
    const config = await ensureConfig();
    const binary = await resolveCodexer();
    const cwd = path.dirname(config.openai.configFile || defaultCodexerConfig());
    const code = await runInteractive(binary, ['auth'], cwd);
    process.exit(code);
  });

openaiCmd
  .command('key')
  .description('Print the bearer key for OpenAI routes')
  .action(async () => {
    const config = await ensureConfig();
    const groupApi = (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey;
    console.log(groupApi ?? '(no key — run openai login first)');
  });

function printOpenAiAccounts(configFile: string): Promise<void> {
  return loadCodexerAccounts(configFile)
    .then((accounts) => {
      if (accounts.length === 0) {
        console.log('No accounts. Run: ai-proxy openai login');
        return;
      }
      console.log('group\tgid\tuuid\talias\ttoken');
      for (const account of accounts) {
        const token = account.hasToken ? 'yes' : 'no';
        console.log(
          `${account.groupName}\t${account.gid}\t${account.uuid}\t${account.alias}\t${token}`,
        );
      }
    })
    .catch(() => {
      console.log('No config yet. Run: ai-proxy openai login');
    });
}

openaiCmd
  .command('accounts')
  .alias('list')
  .description('List ChatGPT OAuth accounts in ~/.config/codexer/config.yml')
  .action(async () => {
    const config = await loadConfig();
    await printOpenAiAccounts(config.openai.configFile);
  });

const anthropicCmd = program.command('anthropic').description('Anthropic / Claude OAuth pool');

anthropicCmd
  .command('login')
  .description('Add Claude account via tcr login (OAuth); writes ~/.config/teamclaude.json')
  .action(async () => {
    await ensureConfig();
    try {
      const binary = await resolveTeamclaude();
      const code = await runInteractive(binary, ['login']);
      process.exit(code);
    } catch {
      console.error('tcr not found. Run: npm run install-binaries');
      process.exit(1);
    }
  });

anthropicCmd
  .command('accounts')
  .description('List accounts in the Anthropic pool')
  .action(async () => {
    const config = await loadConfig();
    try {
      const pool = await loadAnthropicPool(config.anthropic.configFile);
      if (pool.accounts.length === 0) {
        console.log('No accounts. Run: ai-proxy anthropic login');
        return;
      }
      for (const account of pool.accounts) {
        const state = account.disabled ? 'disabled' : 'active';
        console.log(`${account.name}\t${state}`);
      }
    } catch {
      console.log('No config yet. Run: ai-proxy anthropic login');
    }
  });

program
  .command('env')
  .description('Print env for both providers (unified port)')
  .action(async () => {
    const config = await ensureConfig();
    const port = publicPort(config);
    const key =
      (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey ?? '';
    console.log(`export AI_PROXY_URL=http://127.0.0.1:${port}`);
    console.log(`export OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`);
    console.log(`export OPENAI_API_KEY=${key}`);
    console.log(`export CODEXER_API_KEY=${key}`);
    console.log(`export ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
    console.log('# Do NOT set ANTHROPIC_API_KEY for Claude Code — OAuth is injected from the pool');
  });

program
  .command('openai-env')
  .description('Print OpenAI env only')
  .action(async () => {
    const config = await ensureConfig();
    const port = publicPort(config);
    const key =
      (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey ?? '';
    console.log(`export OPENAI_BASE_URL=http://127.0.0.1:${port}/v1`);
    console.log(`export OPENAI_API_KEY=${key}`);
    console.log(`export CODEXER_API_KEY=${key}`);
  });

program
  .command('config-path')
  .description('Print supervisor config path')
  .action(() => {
    console.log(supervisorConfigPath());
  });

function publicPort(config: Awaited<ReturnType<typeof loadConfig>>): number {
  return config.unified.enabled ? config.unified.port : config.anthropic.port;
}

async function startForegroundUnified(
  config: Awaited<ReturnType<typeof ensureConfig>>,
): Promise<void> {
  const codexer = await resolveCodexer();
  await startCodexer(codexer, config.openai, { foreground: false });
  const codexerUp = await waitForUp(`http://127.0.0.1:${config.openai.port}/`);
  if (!codexerUp) {
    throw new Error(`codexer did not start on :${config.openai.port}`);
  }

  const port = publicPort(config);
  startUnifiedServer({
    port,
    anthropicConfigFile: config.anthropic.configFile,
    codexerInternalPort: config.openai.port,
  });

  console.log(`AI-proxy unified http://127.0.0.1:${port}  (codexer internal :${config.openai.port})`);
  console.log('Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => resolve());
    process.on('SIGTERM', () => resolve());
  });
  await stopManaged('openai');
}

async function startLegacy(
  config: Awaited<ReturnType<typeof ensureConfig>>,
  foreground: boolean,
): Promise<void> {
  const codexer = await resolveCodexer();
  const tcr = await resolveTeamclaude();
  await startCodexer(codexer, config.openai, { foreground });
  await startAnthropic(tcr, config.anthropic, { foreground });
  if (!foreground) {
    const openaiUp = await waitForUp(`http://127.0.0.1:${config.openai.port}/`);
    const anthropicUp = await waitForUp(`http://127.0.0.1:${config.anthropic.port}/`);
    console.log(`Legacy mode: openai :${config.openai.port} ${openaiUp ? 'UP' : 'DOWN'}`);
    console.log(`Legacy mode: anthropic :${config.anthropic.port} ${anthropicUp ? 'UP' : 'DOWN'}`);
  }
}

function printStatus(
  config: Awaited<ReturnType<typeof loadConfig>>,
  unifiedUp: boolean,
  unifiedProc?: Awaited<ReturnType<typeof readManaged>>,
  openaiProc?: Awaited<ReturnType<typeof readManaged>>,
): void {
  const port = unifiedProc?.port ?? publicPort(config);
  console.log('AI-proxy status\n');
  console.log(
    `  Unified   http://127.0.0.1:${port}  ${unifiedUp ? 'UP' : 'DOWN'}${
      unifiedProc ? `  pid=${unifiedProc.pid}` : ''
    }`,
  );
  console.log(
    `  Codexer   http://127.0.0.1:${config.openai.port}  (internal)${
      openaiProc ? `  pid=${openaiProc.pid}` : ''
    }`,
  );
  console.log(`  Anthropic pool: ${config.anthropic.configFile}`);
  console.log(`\n  Config: ${supervisorConfigPath()}`);
  console.log('\n  Client setup:  ai-proxy env');
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
