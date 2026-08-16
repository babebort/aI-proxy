import { parseOpenAiJwtMeta } from './jwt-meta.js';

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export interface OpenAiQuotaWindow {
  usedPercent: number;
  resetAt?: number;
  resetAfterSeconds?: number;
  windowSeconds?: number;
}

export interface OpenAiQuotaSnapshot {
  alias: string;
  uuid: string;
  email?: string;
  planType?: string;
  ok: boolean;
  error?: string;
  limitReached?: boolean;
  primary?: OpenAiQuotaWindow;
  secondary?: OpenAiQuotaWindow;
}

interface WhamUsageResponse {
  email?: string;
  plan_type?: string;
  rate_limit?: {
    limit_reached?: boolean;
    primary_window?: {
      used_percent?: number;
      reset_at?: number;
      reset_after_seconds?: number;
      limit_window_seconds?: number;
    };
    secondary_window?: {
      used_percent?: number;
      reset_at?: number;
      reset_after_seconds?: number;
      limit_window_seconds?: number;
    } | null;
  };
}

function mapWindow(raw?: {
  used_percent?: number;
  reset_at?: number;
  reset_after_seconds?: number;
  limit_window_seconds?: number;
} | null): OpenAiQuotaWindow | undefined {
  if (!raw || typeof raw.used_percent !== 'number') {
    return undefined;
  }
  return {
    usedPercent: raw.used_percent,
    resetAt: raw.reset_at,
    resetAfterSeconds: raw.reset_after_seconds,
    windowSeconds: raw.limit_window_seconds,
  };
}

export interface ProbeOpenAiAccountInput {
  alias: string;
  uuid: string;
  accessToken: string;
  idToken?: string;
  chatgptAccountId?: string;
}

export async function probeOpenAiAccount(input: ProbeOpenAiAccountInput): Promise<OpenAiQuotaSnapshot> {
  const meta = parseOpenAiJwtMeta(input.idToken ?? input.accessToken);
  const accountId = input.chatgptAccountId ?? meta.chatgptAccountId;
  const base = {
    alias: input.alias,
    uuid: input.uuid,
    email: meta.email,
    planType: meta.planType,
  };

  if (!input.accessToken.trim()) {
    return { ...base, ok: false, error: 'no token' };
  }
  if (!accountId) {
    return { ...base, ok: false, error: 'missing chatgpt account id' };
  }

  try {
    const response = await fetch(WHAM_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${input.accessToken.trim()}`,
        'ChatGPT-Account-Id': accountId,
        Originator: 'codex_cli_rs',
        Version: '0.146.0',
        'User-Agent': 'codex_cli_rs/0.146.0',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = (await response.text()).trim().slice(0, 200);
      return { ...base, ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }

    const data = (await response.json()) as WhamUsageResponse;
    const primary = mapWindow(data.rate_limit?.primary_window);
    const secondary = data.rate_limit?.secondary_window
      ? mapWindow(data.rate_limit.secondary_window)
      : undefined;

    return {
      ...base,
      email: data.email ?? base.email,
      planType: data.plan_type ?? base.planType,
      ok: true,
      limitReached: data.rate_limit?.limit_reached,
      primary,
      secondary,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeAllOpenAiAccounts(
  accounts: ProbeOpenAiAccountInput[],
  concurrency = 4,
): Promise<OpenAiQuotaSnapshot[]> {
  const results: OpenAiQuotaSnapshot[] = [];
  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const chunk = await Promise.all(batch.map((account) => probeOpenAiAccount(account)));
    results.push(...chunk);
  }
  return results;
}
