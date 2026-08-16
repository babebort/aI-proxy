import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function aiProxyHome(): string {
  return process.env.AI_PROXY_HOME ?? path.join(homedir(), '.config', 'ai-proxy');
}

export function bundledBinDir(): string {
  return path.join(repoRoot, 'resources', 'bin');
}

export function defaultCodexerConfig(): string {
  return path.join(homedir(), 'codexer', 'config.yml');
}

export function defaultAnthropicConfig(): string {
  return path.join(homedir(), '.config', 'teamclaude.json');
}

export function runDir(): string {
  return path.join(aiProxyHome(), 'run');
}

export function supervisorConfigPath(): string {
  return path.join(aiProxyHome(), 'config.yml');
}

export function logDir(): string {
  return path.join(aiProxyHome(), 'logs');
}

export const DEFAULT_OPENAI_GID =
  'cfe83f1b603c9dfef46e8ea3eca0eac2bfb59411a7687a405a05eb4c483f3949';
