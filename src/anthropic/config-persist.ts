import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface AccountTokenUpdate {
  name: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  disabled?: boolean;
}

/** Atomically update one account's tokens in teamclaude.json (refresh tokens are single-use). */
export async function persistAccountTokens(
  configFile: string,
  update: AccountTokenUpdate,
): Promise<void> {
  const raw = JSON.parse(await fs.readFile(configFile, 'utf8')) as Record<string, unknown>;
  const accounts = raw.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error(`invalid anthropic config: missing accounts array in ${configFile}`);
  }

  let found = false;
  for (const item of accounts) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (row.name !== update.name) {
      continue;
    }
    row.accessToken = update.accessToken;
    if (update.refreshToken !== undefined) {
      row.refreshToken = update.refreshToken;
    }
    if (update.expiresAt !== undefined) {
      row.expiresAt = update.expiresAt;
    }
    if (update.disabled !== undefined) {
      row.disabled = update.disabled;
    }
    found = true;
    break;
  }

  if (!found) {
    throw new Error(`account "${update.name}" not found in ${configFile}`);
  }

  const dir = dirname(configFile);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${configFile}.tmp-${process.pid}`;
  const body = `${JSON.stringify(raw, null, 2)}\n`;
  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, configFile);
}
