const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

export interface QuotaWindow {
  utilization: number;
  resetMs?: number;
}

export interface QuotaState {
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
  status?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  requestsLimit?: number;
  requestsRemaining?: number;
  standardResetMs?: number;
}

export type HeaderView = Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderView, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    return undefined;
  }
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseFloat(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

function parseResetMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  const asNumber = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === trimmed) {
    return asNumber < 1_000_000_000_000 ? asNumber * 1000 : asNumber;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveResetMs(
  reportedMs: number | undefined,
  priorResetMs: number | undefined,
  nowMs: number,
  windowMs: number,
): number | undefined {
  if (reportedMs !== undefined) {
    return reportedMs;
  }
  if (priorResetMs !== undefined && priorResetMs > nowMs) {
    return priorResetMs;
  }
  return nowMs + windowMs;
}

export function effectiveUtilization(window: QuotaWindow | undefined, nowMs: number): number {
  if (!window) {
    return 0;
  }
  if (window.resetMs !== undefined && nowMs >= window.resetMs) {
    return 0;
  }
  return window.utilization;
}

/** Merge rate-limit headers from an upstream response. Returns true if 5h window was reported. */
export function updateQuotaFromHeaders(quota: QuotaState, headers: HeaderView, nowMs = Date.now()): boolean {
  let readFiveHour = false;

  const fiveUtil = parseNumber(headerValue(headers, 'anthropic-ratelimit-unified-5h-utilization'));
  if (fiveUtil !== undefined) {
    quota.fiveHour = {
      utilization: fiveUtil,
      resetMs: resolveResetMs(
        parseResetMs(headerValue(headers, 'anthropic-ratelimit-unified-5h-reset')),
        quota.fiveHour?.resetMs,
        nowMs,
        FIVE_HOUR_MS,
      ),
    };
    readFiveHour = true;
  }

  const sevenUtil = parseNumber(headerValue(headers, 'anthropic-ratelimit-unified-7d-utilization'));
  if (sevenUtil !== undefined) {
    quota.sevenDay = {
      utilization: sevenUtil,
      resetMs: resolveResetMs(
        parseResetMs(headerValue(headers, 'anthropic-ratelimit-unified-7d-reset')),
        quota.sevenDay?.resetMs,
        nowMs,
        SEVEN_DAY_MS,
      ),
    };
  }

  const status = headerValue(headers, 'anthropic-ratelimit-unified-status');
  if (status) {
    quota.status = status;
  }

  const tokensLimit = parseNumber(headerValue(headers, 'anthropic-ratelimit-tokens-limit'));
  if (tokensLimit !== undefined) {
    quota.tokensLimit = tokensLimit;
  }
  const tokensRemaining = parseNumber(headerValue(headers, 'anthropic-ratelimit-tokens-remaining'));
  if (tokensRemaining !== undefined) {
    quota.tokensRemaining = tokensRemaining;
  }
  const requestsLimit = parseNumber(headerValue(headers, 'anthropic-ratelimit-requests-limit'));
  if (requestsLimit !== undefined) {
    quota.requestsLimit = requestsLimit;
  }
  const requestsRemaining = parseNumber(headerValue(headers, 'anthropic-ratelimit-requests-remaining'));
  if (requestsRemaining !== undefined) {
    quota.requestsRemaining = requestsRemaining;
  }

  const standardReset =
    parseResetMs(headerValue(headers, 'anthropic-ratelimit-tokens-reset')) ??
    parseResetMs(headerValue(headers, 'anthropic-ratelimit-requests-reset'));
  if (standardReset !== undefined) {
    quota.standardResetMs = standardReset;
  }

  return readFiveHour;
}

/** True when any gating dimension is at/over threshold (live against reset times). */
export function isNearQuotaLimit(quota: QuotaState, threshold: number, nowMs = Date.now()): boolean {
  if (effectiveUtilization(quota.fiveHour, nowMs) >= threshold) {
    return true;
  }
  if (effectiveUtilization(quota.sevenDay, nowMs) >= threshold) {
    return true;
  }

  const standardExpired = quota.standardResetMs !== undefined && nowMs >= quota.standardResetMs;
  if (!standardExpired) {
    if (quota.tokensLimit !== undefined && quota.tokensRemaining !== undefined && quota.tokensLimit > 0) {
      if (1 - quota.tokensRemaining / quota.tokensLimit >= threshold) {
        return true;
      }
    }
    if (quota.requestsLimit !== undefined && quota.requestsRemaining !== undefined && quota.requestsLimit > 0) {
      if (1 - quota.requestsRemaining / quota.requestsLimit >= threshold) {
        return true;
      }
    }
  }

  return false;
}

export function maxUtilization(quota: QuotaState, nowMs = Date.now()): number {
  return Math.max(effectiveUtilization(quota.fiveHour, nowMs), effectiveUtilization(quota.sevenDay, nowMs));
}
