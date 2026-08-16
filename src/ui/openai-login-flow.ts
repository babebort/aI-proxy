import { randomBytes } from 'node:crypto';
import { ensureConfig } from '../config.js';
import { createOAuthClient, parseCodeInput, type OAuthSession } from '../openai/oauth-client.js';
import { waitForOAuthCallback } from '../openai/oauth-callback.js';
import {
  addCodexerUser,
  listCodexerGroups,
  removeCodexerUser,
  type SavedCodexerUser,
} from './account-store.js';

export type LoginSessionStatus = 'waiting' | 'exchanging' | 'done' | 'error';

export interface LoginSession {
  id: string;
  status: LoginSessionStatus;
  authUrl: string;
  oauthSession: OAuthSession;
  alias: string;
  gid?: string;
  newGroupName?: string;
  error?: string;
  account?: SavedCodexerUser;
  createdAt: number;
}

const sessions = new Map<string, LoginSession>();
const SESSION_TTL_MS = 10 * 60 * 1000;

function purgeExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      sessions.delete(id);
    }
  }
}

function newSessionId(): string {
  return randomBytes(12).toString('hex');
}

async function finishLogin(session: LoginSession, code: string): Promise<void> {
  session.status = 'exchanging';
  const config = await ensureConfig();
  const client = createOAuthClient();
  const tokens = await client.exchangeCode(session.oauthSession, code);
  const account = await addCodexerUser(config.openai.configFile, {
    alias: session.alias,
    oauthCode: code,
    tokens,
    gid: session.gid,
    newGroupName: session.newGroupName,
  });
  session.account = account;
  session.status = 'done';
}

function startCallbackWait(session: LoginSession): void {
  void (async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = await waitForOAuthCallback(
        session.oauthSession.redirectUri,
        session.oauthSession.state,
      );
      if (session.status === 'done' || session.status === 'error') {
        return;
      }
      await finishLogin(session, result.code);
    } catch (error) {
      if (session.status === 'done') {
        return;
      }
      session.status = 'error';
      session.error = error instanceof Error ? error.message : String(error);
    }
  })();
}

export async function beginOpenAiLogin(opts: {
  alias: string;
  gid?: string;
  newGroupName?: string;
}): Promise<{ sessionId: string; authUrl: string; groups: Awaited<ReturnType<typeof listCodexerGroups>> }> {
  purgeExpiredSessions();
  const alias = opts.alias.trim();
  if (!alias) {
    throw new Error('alias is required');
  }
  const newGroupName = opts.newGroupName?.trim();
  const gid = opts.gid?.trim();
  if (!newGroupName && !gid) {
    throw new Error('gid or newGroupName is required');
  }
  if (newGroupName && gid) {
    throw new Error('send either gid or newGroupName, not both');
  }

  const config = await ensureConfig();
  const groups = await listCodexerGroups(config.openai.configFile);
  if (gid && !groups.some((group) => group.gid === gid)) {
    throw new Error('group not found');
  }

  const client = createOAuthClient();
  const { session: oauthSession, authUrl } = client.generateAuthUrl();
  const session: LoginSession = {
    id: newSessionId(),
    status: 'waiting',
    authUrl,
    oauthSession,
    alias,
    gid,
    newGroupName,
    createdAt: Date.now(),
  };
  sessions.set(session.id, session);
  startCallbackWait(session);
  return { sessionId: session.id, authUrl, groups };
}

export async function submitOpenAiLoginCode(
  sessionId: string,
  input: string,
): Promise<LoginSession> {
  purgeExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('login session not found or expired');
  }
  if (session.status === 'done') {
    return session;
  }
  const { code, state } = parseCodeInput(input);
  if (state && state !== session.oauthSession.state) {
    throw new Error('oauth state mismatch');
  }
  await finishLogin(session, code);
  return session;
}

export function getOpenAiLoginSession(sessionId: string): LoginSession | null {
  purgeExpiredSessions();
  return sessions.get(sessionId) ?? null;
}

export async function listOpenAiLoginGroups() {
  const config = await ensureConfig();
  return listCodexerGroups(config.openai.configFile);
}

export async function beginOpenAiReauth(opts: {
  uuid: string;
  alias: string;
  gid: string;
}): Promise<{ sessionId: string; authUrl: string }> {
  const gid = opts.gid.trim();
  if (!gid) {
    throw new Error('gid is required for reauth');
  }
  const config = await ensureConfig();
  const removed = await removeCodexerUser(config.openai.configFile, opts.uuid);
  if (!removed) {
    throw new Error('account not found');
  }
  return beginOpenAiLogin({
    alias: opts.alias,
    gid,
  });
}
