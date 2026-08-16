import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';
import type { TokenSet } from '../openai/oauth-client.js';

type CodexerDoc = {
  groups?: Array<{
    gid?: string;
    gname?: string;
    api?: string;
    users?: Array<{
      uuid?: string;
      alias?: string;
      oauth_code?: string;
      tokens?: TokenSet;
    }>;
  }>;
};

export interface CodexerGroupInfo {
  gid: string;
  gname: string;
  api: string;
  userCount: number;
}

export interface SavedCodexerUser {
  uuid: string;
  alias: string;
  gid: string;
  gname: string;
  api: string;
}

function newGroupId(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}

function newGroupApi(): string {
  return `gsg_${randomBytes(32).toString('base64url')}`;
}

function newUuid(): string {
  const buf = randomBytes(16);
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  return `${buf.subarray(0, 4).toString('hex')}-${buf.subarray(4, 6).toString('hex')}-${buf.subarray(6, 8).toString('hex')}-${buf.subarray(8, 10).toString('hex')}-${buf.subarray(10).toString('hex')}`;
}

async function loadCodexerDoc(configFile: string): Promise<CodexerDoc> {
  try {
    const text = await fs.readFile(configFile, 'utf8');
    if (!text.trim()) {
      return { groups: [] };
    }
    return parse(text) as CodexerDoc;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const dir = configFile.replace(/\/[^/]+$/, '');
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const empty: CodexerDoc = { groups: [] };
      await fs.writeFile(configFile, stringify(empty), { mode: 0o600 });
      return empty;
    }
    throw error;
  }
}

async function saveCodexerDoc(configFile: string, doc: CodexerDoc): Promise<void> {
  const dir = configFile.replace(/\/[^/]+$/, '');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(configFile, stringify(doc), { mode: 0o600 });
}

export async function listCodexerGroups(configFile: string): Promise<CodexerGroupInfo[]> {
  const doc = await loadCodexerDoc(configFile);
  return (doc.groups ?? []).map((group) => ({
    gid: group.gid ?? '',
    gname: group.gname ?? '',
    api: group.api ?? '',
    userCount: group.users?.length ?? 0,
  }));
}

export async function addCodexerUser(
  configFile: string,
  opts: {
    alias: string;
    oauthCode: string;
    tokens: TokenSet;
    gid?: string;
    newGroupName?: string;
  },
): Promise<SavedCodexerUser> {
  const alias = opts.alias.trim();
  if (!alias) {
    throw new Error('user alias is required');
  }

  const doc = await loadCodexerDoc(configFile);
  const groups = doc.groups ?? [];
  doc.groups = groups;

  const user = {
    uuid: newUuid(),
    alias,
    oauth_code: opts.oauthCode.trim(),
    tokens: opts.tokens,
  };

  const newGroupName = opts.newGroupName?.trim();
  if (newGroupName) {
    if (groups.some((group) => group.gname === newGroupName)) {
      throw new Error(`group "${newGroupName}" already exists`);
    }
    const group = {
      gid: newGroupId(),
      gname: newGroupName,
      api: newGroupApi(),
      users: [user],
    };
    groups.push(group);
    await saveCodexerDoc(configFile, doc);
    return {
      uuid: user.uuid,
      alias: user.alias,
      gid: group.gid,
      gname: group.gname,
      api: group.api,
    };
  }

  const gid = opts.gid?.trim();
  const groupIdx = gid ? groups.findIndex((group) => group.gid === gid) : -1;
  if (groupIdx < 0) {
    throw new Error('group not found');
  }
  const group = groups[groupIdx];
  for (const existing of group.users ?? []) {
    if (existing.alias === alias) {
      throw new Error(`user alias "${alias}" already exists in group`);
    }
  }
  group.users = [...(group.users ?? []), user];
  await saveCodexerDoc(configFile, doc);
  return {
    uuid: user.uuid,
    alias: user.alias,
    gid: group.gid ?? '',
    gname: group.gname ?? '',
    api: group.api ?? '',
  };
}

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
