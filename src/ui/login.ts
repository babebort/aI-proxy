import path from 'node:path';
import { resolveCodexer, resolveTeamclaude } from '../binaries.js';
import { ensureConfig } from '../config.js';
import { defaultCodexerConfig } from '../paths.js';
import { openTerminalCommand } from './open-window.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function banner(lines: string[]): string {
  return `printf ${shellQuote(`\\n=== AI Proxy ===\\n${lines.join('\\n')}\\n\\n`)}`;
}

export async function openOpenAiLoginTerminal(): Promise<boolean> {
  const config = await ensureConfig();
  const binary = await resolveCodexer();
  const cwd = path.dirname(config.openai.configFile || defaultCodexerConfig());
  return openTerminalCommand(`cd ${shellQuote(cwd)} && ${shellQuote(binary)} auth`);
}

export async function openOpenAiReauthTerminal(alias: string): Promise<boolean> {
  const config = await ensureConfig();
  const binary = await resolveCodexer();
  const cwd = path.dirname(config.openai.configFile || defaultCodexerConfig());
  const hint = banner([
    'Reauth ChatGPT',
    `Alias: ${alias}`,
    '1) Выбери ту же группу',
    `2) Введи alias: ${alias}`,
  ]);
  return openTerminalCommand(
    `cd ${shellQuote(cwd)} && ${hint} && ${shellQuote(binary)} auth`,
  );
}

export async function openAnthropicLoginTerminal(): Promise<boolean> {
  await ensureConfig();
  const binary = await resolveTeamclaude();
  return openTerminalCommand(shellQuote(binary) + ' login');
}

export async function openAnthropicReauthTerminal(name: string): Promise<boolean> {
  await ensureConfig();
  const binary = await resolveTeamclaude();
  const hint = banner(['Reauth Claude', `Account name: ${name}`, 'Залогинься тем же аккаунтом']);
  return openTerminalCommand(`${hint} && ${shellQuote(binary)} login`);
}
