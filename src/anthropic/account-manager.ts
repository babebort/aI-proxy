import type { AnthropicAccount, AnthropicPoolConfig } from './types.js';
import { loadAnthropicPool } from './config-loader.js';
import { persistAccountTokens } from './config-persist.js';
import { isExpiringSoon, refreshAccessToken } from './oauth.js';
import { isNearQuotaLimit, maxUtilization, updateQuotaFromHeaders, type QuotaState } from './quota.js';
import { SessionAffinity } from './session.js';

const MAX_RATE_LIMIT_HOLD_MS = 30 * 60 * 1000;

export interface RuntimeAccount extends AnthropicAccount {
  quota: QuotaState;
  rateLimitedUntilMs?: number;
  authRejected?: boolean;
}

export class AccountManager {
  private configFile: string;
  private poolConfig: AnthropicPoolConfig | null = null;
  private runtime = new Map<string, RuntimeAccount>();
  private roundRobinIndex = 0;
  private affinity = new SessionAffinity();
  private persistChain: Promise<void> = Promise.resolve();
  private refreshLocks = new Map<string, Promise<string | null>>();

  constructor(configFile: string) {
    this.configFile = configFile;
  }

  async load(): Promise<AnthropicPoolConfig> {
    const config = await loadAnthropicPool(this.configFile);
    this.poolConfig = config;

    const seen = new Set<string>();
    for (const account of config.accounts) {
      seen.add(account.name);
      const existing = this.runtime.get(account.name);
      if (existing) {
        existing.accessToken = account.accessToken;
        existing.refreshToken = account.refreshToken ?? existing.refreshToken;
        existing.expiresAt = account.expiresAt ?? existing.expiresAt;
        existing.disabled = account.disabled;
        existing.priority = account.priority;
        existing.accountUuid = account.accountUuid;
        existing.type = account.type;
      } else {
        this.runtime.set(account.name, {
          ...account,
          quota: {},
        });
      }
    }

    for (const name of [...this.runtime.keys()]) {
      if (!seen.has(name)) {
        this.runtime.delete(name);
      }
    }

    return config;
  }

  get config(): AnthropicPoolConfig {
    if (!this.poolConfig) {
      throw new Error('AccountManager not loaded');
    }
    return this.poolConfig;
  }

  eligible(nowMs = Date.now()): RuntimeAccount[] {
    return [...this.runtime.values()]
      .filter((a) => this.isSelectable(a, nowMs))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  private isSelectable(account: RuntimeAccount, nowMs: number): boolean {
    if (account.disabled || account.authRejected || !account.accessToken.trim()) {
      return false;
    }
    if (account.rateLimitedUntilMs !== undefined && nowMs < account.rateLimitedUntilMs) {
      return false;
    }
    if (isNearQuotaLimit(account.quota, this.config.switchThreshold, nowMs)) {
      return false;
    }
    return true;
  }

  /** Pick account: affinity pin → least utilized → round-robin. */
  select(sessionKey?: string, skipName?: string, nowMs = Date.now()): RuntimeAccount | null {
    const eligible = this.eligible(nowMs);
    if (eligible.length === 0) {
      return null;
    }

    const pinnedName = this.affinity.lookup(sessionKey, nowMs);
    if (pinnedName && pinnedName !== skipName) {
      const pinned = eligible.find((a) => a.name === pinnedName);
      if (pinned) {
        return pinned;
      }
    }

    const candidates = skipName ? eligible.filter((a) => a.name !== skipName) : eligible;
    const pool = candidates.length > 0 ? candidates : eligible;

    pool.sort((a, b) => {
      const utilDiff = maxUtilization(a.quota, nowMs) - maxUtilization(b.quota, nowMs);
      if (utilDiff !== 0) {
        return utilDiff;
      }
      return (a.priority ?? 0) - (b.priority ?? 0);
    });

    const leastUtil = pool[0]!.quota;
    const tied = pool.filter((a) => maxUtilization(a.quota, nowMs) === maxUtilization(leastUtil, nowMs));

    const start = this.roundRobinIndex % tied.length;
    const picked = tied[start]!;
    this.roundRobinIndex = (start + 1) % Math.max(tied.length, 1);
    return picked;
  }

  pinSession(sessionKey: string | undefined, accountName: string): void {
    if (this.config.sessionAffinity !== false && sessionKey) {
      this.affinity.pin(sessionKey, accountName);
    }
  }

  async accessTokenFor(account: RuntimeAccount): Promise<string | null> {
    const nowMs = Date.now();
    const needsRefresh =
      account.refreshToken &&
      (isExpiringSoon(account.expiresAt, nowMs) || !account.accessToken.trim());

    if (!needsRefresh) {
      return account.accessToken.trim() || null;
    }

    const existing = this.refreshLocks.get(account.name);
    if (existing) {
      return existing;
    }

    const refreshPromise = this.doRefresh(account);
    this.refreshLocks.set(account.name, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.refreshLocks.delete(account.name);
    }
  }

  private async doRefresh(account: RuntimeAccount): Promise<string | null> {
    if (!account.refreshToken?.trim()) {
      return account.accessToken.trim() || null;
    }

    const result = await refreshAccessToken(account.refreshToken);
    if ('kind' in result) {
      if (result.kind === 'auth_rejected') {
        account.authRejected = true;
        account.disabled = true;
        void this.queuePersist({
          name: account.name,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          expiresAt: account.expiresAt,
          disabled: true,
        });
      }
      return account.accessToken.trim() || null;
    }

    account.accessToken = result.accessToken;
    account.refreshToken = result.refreshToken;
    account.expiresAt = result.expiresAt;
    account.authRejected = false;

    void this.queuePersist({
      name: account.name,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    });

    return result.accessToken;
  }

  updateQuotaFromResponse(accountName: string, headers: Record<string, string | string[]>): void {
    const account = this.runtime.get(accountName);
    if (!account) {
      return;
    }
    updateQuotaFromHeaders(account.quota, headers);
  }

  markRateLimited(accountName: string, retryAfterSeconds: number, nowMs = Date.now()): void {
    const account = this.runtime.get(accountName);
    if (!account) {
      return;
    }
    const holdMs = Math.min(Math.max(retryAfterSeconds, 0), MAX_RATE_LIMIT_HOLD_MS / 1000) * 1000;
    account.rateLimitedUntilMs = nowMs + holdMs;
  }

  clearRateLimited(accountName: string): void {
    const account = this.runtime.get(accountName);
    if (account) {
      account.rateLimitedUntilMs = undefined;
    }
  }

  size(): number {
    return this.eligible().length;
  }

  private queuePersist(update: Parameters<typeof persistAccountTokens>[1]): Promise<void> {
    this.persistChain = this.persistChain
      .then(() => persistAccountTokens(this.configFile, update))
      .catch((error: unknown) => {
        console.error(
          `[ai-proxy] failed to persist tokens for ${update.name}:`,
          error instanceof Error ? error.message : error,
        );
      });
    return this.persistChain;
  }
}

const managers = new Map<string, AccountManager>();

export function getAccountManager(configFile: string): AccountManager {
  let manager = managers.get(configFile);
  if (!manager) {
    manager = new AccountManager(configFile);
    managers.set(configFile, manager);
  }
  return manager;
}

export async function loadAccountManager(configFile: string): Promise<AccountManager> {
  const manager = getAccountManager(configFile);
  await manager.load();
  return manager;
}
