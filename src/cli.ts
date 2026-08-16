#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import {
  ensureAnthropicConfig,
  ensureConfig,
  loadConfig,
  readCodexerGroupApi,
} from './config.js';
import { resolveCodexer, resolveTeamclaude } from './binaries.js';
import { probeHttp, waitForUp } from './health.js';
import {
  readManaged,
  runInteractive,
  startAnthropic,
  startCodexer,
  stopManaged,
} from './process.js';
import { defaultCodexerConfig, supervisorConfigPath } from './paths.js';

const program = new Command();

program
  .name('ai-proxy')
  .description('Dual-provider local proxy: OpenAI (codexer) + Anthropic (teamclaude-rs)')
  .version('0.1.0');

program
  .command('start')
  .description('Start OpenAI (:9090) and Anthropic (:3456) proxy backends')
  .option('-f, --foreground', 'Run in foreground (logs to terminal)')
  .action(async (opts: { foreground?: boolean }) => {
    const config = await ensureConfig();
    await ensureAnthropicConfig(config.anthropic.configFile, config.anthropic.apiKey);

    const codexer = await resolveCodexer();
    const tcr = await resolveTeamclaude();

    const openai = await startCodexer(codexer, config.openai, {
      foreground: opts.foreground,
    });
    const anthropic = await startAnthropic(tcr, config.anthropic, {
      foreground: opts.foreground,
    });

    if (!opts.foreground) {
      const openaiUp = await waitForUp(`http://127.0.0.1:${config.openai.port}/`);
      const anthropicUp = await waitForUp(`http://127.0.0.1:${config.anthropic.port}/`);
      printStatus(config, openai, anthropic, openaiUp, anthropicUp);
      return;
    }

    console.log('AI-proxy running in foreground. Ctrl+C to stop.');
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => resolve());
      process.on('SIGTERM', () => resolve());
    });
  });

program
  .command('stop')
  .description('Stop managed proxy backends')
  .action(async () => {
    const stoppedOpenai = await stopManaged('openai');
    const stoppedAnthropic = await stopManaged('anthropic');
    if (!stoppedOpenai && !stoppedAnthropic) {
      console.log('Nothing running.');
      return;
    }
    console.log(
      `Stopped:${stoppedOpenai ? ' openai' : ''}${stoppedAnthropic ? ' anthropic' : ''}`,
    );
  });

program
  .command('status')
  .description('Show proxy health and client env hints')
  .action(async () => {
    const config = await loadConfig();
    const openaiProc = await readManaged('openai');
    const anthropicProc = await readManaged('anthropic');
    const openaiUp = (await probeHttp(`http://127.0.0.1:${config.openai.port}/`)).up;
    const anthropicUp = (await probeHttp(`http://127.0.0.1:${config.anthropic.port}/`)).up;
    printStatus(config, openaiProc, anthropicProc, openaiUp, anthropicUp);
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
  .description('Print the bearer key clients should send to the OpenAI proxy')
  .action(async () => {
    const config = await ensureConfig();
    const groupApi = (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey;
    console.log(groupApi ?? '(no key — run openai login first)');
  });

const anthropicCmd = program.command('anthropic').description('Anthropic / Claude (teamclaude-rs)');

anthropicCmd
  .command('login')
  .description('Add a Claude Max/Pro OAuth account (tcr login)')
  .action(async () => {
    await ensureConfig();
    const binary = await resolveTeamclaude();
    const code = await runInteractive(binary, ['login']);
    process.exit(code);
  });

anthropicCmd
  .command('accounts')
  .description('List Anthropic pool accounts')
  .action(async () => {
    const binary = await resolveTeamclaude();
    const code = await runInteractive(binary, ['accounts']);
    process.exit(code);
  });

anthropicCmd
  .command('env')
  .description('Print env vars for BB / Cursor / Claude Code')
  .action(async () => {
    const config = await ensureConfig();
    const port = config.anthropic.port;
    console.log(`export ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
    console.log('# teamclaude-rs uses OAuth injection — do NOT set ANTHROPIC_API_KEY for Claude Code');
    console.log('# For SDK clients on loopback, apiKey gate is optional');
    if (config.anthropic.apiKey) {
      console.log(`# Control routes only: export AI_PROXY_ANTHROPIC_KEY=${config.anthropic.apiKey}`);
    }
  });

program
  .command('openai-env')
  .description('Print env vars for OpenAI-compatible clients')
  .action(async () => {
    const config = await ensureConfig();
    const key =
      (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey ?? '';
    console.log(`export OPENAI_BASE_URL=http://127.0.0.1:${config.openai.port}/v1`);
    console.log(`export OPENAI_API_KEY=${key}`);
    console.log(`export CODEXER_API_KEY=${key}`);
  });

program
  .command('config-path')
  .description('Print supervisor config path')
  .action(() => {
    console.log(supervisorConfigPath());
  });

function printStatus(
  config: Awaited<ReturnType<typeof loadConfig>>,
  openaiProc: Awaited<ReturnType<typeof readManaged>>,
  anthropicProc: Awaited<ReturnType<typeof readManaged>>,
  openaiUp: boolean,
  anthropicUp: boolean,
): void {
  console.log('AI-proxy status\n');
  console.log(
    `  OpenAI    http://127.0.0.1:${config.openai.port}  ${openaiUp ? 'UP' : 'DOWN'}${
      openaiProc ? `  pid=${openaiProc.pid}` : ''
    }`,
  );
  console.log(
    `  Anthropic http://127.0.0.1:${config.anthropic.port}  ${anthropicUp ? 'UP' : 'DOWN'}${
      anthropicProc ? `  pid=${anthropicProc.pid}` : ''
    }`,
  );
  console.log(`\n  Config: ${supervisorConfigPath()}`);
  console.log('\n  Client setup:');
  console.log('    ai-proxy openai-env');
  console.log('    ai-proxy anthropic env');
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
