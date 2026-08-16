import { access } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { bundledBinDir } from './paths.js';

export async function resolveBinary(
  name: string,
  envVar: string,
  fallbacks: string[],
): Promise<string> {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    await assertExecutable(fromEnv, `${envVar}=${fromEnv}`);
    return fromEnv;
  }

  const bundled = path.join(bundledBinDir(), name);
  try {
    await assertExecutable(bundled, bundled);
    return bundled;
  } catch {
    // try fallbacks
  }

  for (const candidate of fallbacks) {
    const resolved = candidate.startsWith('~')
      ? path.join(homedir(), candidate.slice(1))
      : candidate;
    try {
      await assertExecutable(resolved, resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(
    `${name} not found. Run: npm run install-binaries\n` +
      `  or set ${envVar} to the binary path`,
  );
}

async function assertExecutable(file: string, label: string): Promise<void> {
  await access(file);
  if (!file.includes(path.sep)) {
    return;
  }
  const stat = await import('node:fs/promises').then((fs) => fs.stat(file));
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file`);
  }
}

export async function resolveCodexer(): Promise<string> {
  return resolveBinary('codexer', 'AI_PROXY_CODEXER', []);
}

export async function resolveTeamclaude(): Promise<string> {
  return resolveBinary('tcr', 'AI_PROXY_TCR', ['~/.local/bin/tcr']);
}
