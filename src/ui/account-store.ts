import { promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';

export async function removeCodexerUser(configFile: string, uuid: string): Promise<boolean> {
  const text = await fs.readFile(configFile, 'utf8');
  const doc = parse(text) as {
    groups?: Array<{ users?: Array<{ uuid?: string }> }>;
  };
  let removed = false;
  for (const group of doc.groups ?? []) {
    const users = group.users ?? [];
    const next = users.filter((user) => user.uuid !== uuid);
    if (next.length !== users.length) {
      group.users = next;
      removed = true;
    }
  }
  if (!removed) {
    return false;
  }
  await fs.writeFile(configFile, stringify(doc), { mode: 0o600 });
  return true;
}

export async function removeAnthropicAccount(configFile: string, name: string): Promise<boolean> {
  const raw = JSON.parse(await fs.readFile(configFile, 'utf8')) as {
    accounts?: Array<{ name?: string }>;
  };
  const accounts = raw.accounts ?? [];
  const next = accounts.filter((row) => row.name !== name);
  if (next.length === accounts.length) {
    return false;
  }
  raw.accounts = next;
  await fs.writeFile(configFile, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  return true;
}

export function needsAccountReauth(error: string | undefined): boolean {
  if (!error?.trim()) {
    return false;
  }
  const err = error.toLowerCase();
  return (
    err.includes('missing chatgpt account id') ||
    err.includes('no token') ||
    err.includes('http 401') ||
    err.includes('http 403') ||
    err.includes('expired') ||
    err.includes('invalid') ||
    err.includes('unauthorized')
  );
}
