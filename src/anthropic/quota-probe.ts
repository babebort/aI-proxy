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
  probeModel?: string;
}

const COUNT_TOKENS_URL = 'https://api.anthropic.com/v1/messages/count_tokens';

/** Cheapest first; retired snapshot ids are skipped via 404 fallback. */
export const PROBE_MODELS = [
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
] as const;

export function hasQuotaData(quota: QuotaState | undefined): boolean {
  if (!quota) {
    return false;
  }
  return Boolean(quota.fiveHour || quota.sevenDay || quota.tokensLimit !== undefined);
}

function isModelNotFound(status: number, body: string): boolean {
  if (status !== 404) {
    return false;
  }
  return /not_found_error|"model:/i.test(body);
}

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

async function probeWithModel(
  token: string,
  model: string,
): Promise<{ response: Response; quota: QuotaState; body: string }> {
  const response = await fetch(COUNT_TOKENS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const quota: QuotaState = {};
  updateQuotaFromHeaders(quota, Object.fromEntries(response.headers.entries()));
  const body = (await response.text()).trim();
  return { response, quota, body };
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
    let lastError = 'probe failed';
    let lastQuota: QuotaState | undefined;

    for (const model of PROBE_MODELS) {
      const { response, quota, body } = await probeWithModel(token, model);
      lastQuota = quota;

      if (response.ok || response.status === 429) {
        const nowMs = Date.now();
        return {
          ...base,
          ok: true,
          quota,
          maxUtilization: maxUtilization(quota, nowMs),
          probeModel: model,
          error: response.status === 429 ? 'rate limited (quota read)' : undefined,
        };
      }

      if (hasQuotaData(quota)) {
        const nowMs = Date.now();
        return {
          ...base,
          ok: true,
          quota,
          maxUtilization: maxUtilization(quota, nowMs),
          probeModel: model,
        };
      }

      const detail = body.slice(0, 200);
      lastError = `HTTP ${response.status}${detail ? `: ${detail}` : ''}`;

      if (isModelNotFound(response.status, body)) {
        continue;
      }

      return {
        ...base,
        ok: false,
        error: lastError,
        quota,
        probeModel: model,
      };
    }

    return {
      ...base,
      ok: false,
      error: lastError,
      quota: lastQuota,
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
