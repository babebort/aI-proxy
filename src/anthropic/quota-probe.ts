import { refreshAccessToken } from './oauth.js';
import { maxUtilization, updateQuotaFromHeaders, type QuotaState } from './quota.js';
import type { AnthropicAccount } from './types.js';

export interface AnthropicQuotaSnapshot {
  name: string;
  ok: boolean;
  error?: string;
  disabled?: boolean;
  expiresAt?: number;
  quota?: QuotaState;
  maxUtilization?: number;
}

const COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const PROBE_MODEL = 'claude-sonnet-4-20250514';

async function tokenForProbe(account: AnthropicAccount): Promise<string | null> {
  const trimmed = account.accessToken.trim();
  if (!trimmed) {
    return null;
  }
  const nowMs = Date.now();
  const expiring =
    account.refreshToken &&
    account.expiresAt !== undefined &&
    nowMs + 5 * 60_000 >= account.expiresAt;
  if (!expiring) {
    return trimmed;
  }
  const refreshed = await refreshAccessToken(account.refreshToken!);
  if ('kind' in refreshed) {
    return trimmed;
  }
  return refreshed.accessToken;
}

export async function probeAnthropicAccount(account: AnthropicAccount): Promise<AnthropicQuotaSnapshot> {
  const base = {
    name: account.name,
    disabled: account.disabled,
    expiresAt: account.expiresAt,
  };

  if (account.disabled) {
    return { ...base, ok: false, error: 'disabled' };
  }

  const token = await tokenForProbe(account);
  if (!token) {
    return { ...base, ok: false, error: 'no token' };
  }

  try {
    const response = await fetch(COUNT_TOKENS_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: PROBE_MODEL,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const quota: QuotaState = {};
    updateQuotaFromHeaders(quota, Object.fromEntries(response.headers.entries()));

    if (!response.ok && response.status !== 429) {
      const detail = (await response.text()).trim().slice(0, 200);
      return { ...base, ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`, quota };
    }

    const nowMs = Date.now();
    return {
      ...base,
      ok: true,
      quota,
      maxUtilization: maxUtilization(quota, nowMs),
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeAllAnthropicAccounts(
  accounts: AnthropicAccount[],
  concurrency = 3,
): Promise<AnthropicQuotaSnapshot[]> {
  const results: AnthropicQuotaSnapshot[] = [];
  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const chunk = await Promise.all(batch.map((account) => probeAnthropicAccount(account)));
    results.push(...chunk);
  }
  return results;
}
