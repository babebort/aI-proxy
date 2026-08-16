import { spawn, type ChildProcess } from 'node:child_process';
import { openSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AnthropicConfig, OpenAiConfig } from './config.js';
import { logDir, runDir } from './paths.js';

export interface ManagedProcess {
  name: string;
  pid: number;
  port: number;
  logFile: string;
}

export interface StartOptions {
  foreground?: boolean;
}

async function writePid(name: string, pid: number, port: number): Promise<void> {
  await fs.mkdir(runDir(), { recursive: true, mode: 0o700 });
  const file = path.join(runDir(), `${name}.json`);
  const body = JSON.stringify({ pid, port, startedAt: new Date().toISOString() }, null, 2);
  await fs.writeFile(file, body, { mode: 0o600 });
}

export async function readManaged(name: string): Promise<ManagedProcess | null> {
  const file = path.join(runDir(), `${name}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as {
      pid: number;
      port: number;
    };
    process.kill(raw.pid, 0);
    return { name, pid: raw.pid, port: raw.port, logFile: path.join(logDir(), `${name}.log`) };
  } catch {
    return null;
  }
}

export async function stopManaged(name: string): Promise<boolean> {
  const managed = await readManaged(name);
  if (!managed) {
    return false;
  }
  try {
    process.kill(managed.pid, 'SIGTERM');
  } catch {
    // already dead
  }
  await fs.unlink(path.join(runDir(), `${name}.json`)).catch(() => undefined);
  return true;
}

function spawnLogged(
  name: string,
  executable: string,
  args: string[],
  options: { cwd?: string; foreground?: boolean },
): ChildProcess {
  void fs.mkdir(logDir(), { recursive: true, mode: 0o700 });

  if (options.foreground) {
    return spawn(executable, args, {
      cwd: options.cwd,
      stdio: 'inherit',
      env: process.env,
    });
  }

  const logPath = path.join(logDir(), `${name}.log`);
  const logFd = syncAppendFd(logPath);
  const child = spawn(executable, args, {
    cwd: options.cwd,
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: process.env,
  });
  child.unref();
  return child;
}

function syncAppendFd(logPath: string): number {
  return openSync(logPath, 'a');
}

export async function startCodexer(
  binary: string,
  config: OpenAiConfig,
  options: StartOptions,
): Promise<ManagedProcess> {
  const existing = await readManaged('openai');
  if (existing) {
    return existing;
  }

  const configDir = path.dirname(config.configFile);
  const userCount = await countCodexerUsers(config.configFile, config.gid);
  const modeArgs =
    userCount >= 2
      ? ['server', '--multiuser', '--gid', config.gid]
      : ['server', '--singleuser', '--gid', config.gid, '--alias', 'default'];

  const child = spawnLogged('openai', binary, modeArgs, {
    cwd: configDir,
    foreground: options.foreground,
  });

  if (!child.pid) {
    throw new Error('codexer failed to start');
  }

  await writePid('openai', child.pid, config.port);
  return {
    name: 'openai',
    pid: child.pid,
    port: config.port,
    logFile: path.join(logDir(), 'openai.log'),
  };
}

export async function startAnthropic(
  binary: string,
  config: AnthropicConfig,
  options: StartOptions,
): Promise<ManagedProcess> {
  const existing = await readManaged('anthropic');
  if (existing) {
    return existing;
  }

  const args = ['server', '--port', String(config.port)];
  const child = spawnLogged('anthropic', binary, args, {
    foreground: options.foreground,
  });

  if (!child.pid) {
    throw new Error('teamclaude-rs (tcr) failed to start');
  }

  await writePid('anthropic', child.pid, config.port);
  return {
    name: 'anthropic',
    pid: child.pid,
    port: config.port,
    logFile: path.join(logDir(), 'anthropic.log'),
  };
}

async function countCodexerUsers(configFile: string, gid: string): Promise<number> {
  try {
    const { parse } = await import('yaml');
    const text = await fs.readFile(configFile, 'utf8');
    const doc = parse(text) as { groups?: Array<{ gid?: string; users?: unknown[] }> };
    for (const group of doc.groups ?? []) {
      if (group.gid === gid) {
        return group.users?.length ?? 0;
      }
    }
  } catch {
    // fall through
  }
  return 0;
}

export async function runInteractive(
  binary: string,
  args: string[],
  cwd?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}
