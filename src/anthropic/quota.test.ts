import { describe, expect, it } from 'vitest';
import {
  effectiveUtilization,
  isNearQuotaLimit,
  updateQuotaFromHeaders,
  type QuotaState,
} from './quota.js';

describe('quota', () => {
  it('parses unified utilization headers', () => {
    const quota: QuotaState = {};
    const read = updateQuotaFromHeaders(quota, {
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
      'anthropic-ratelimit-unified-5h-reset': '1893456000',
      'anthropic-ratelimit-unified-7d-utilization': '0.10',
    });
    expect(read).toBe(true);
    expect(quota.fiveHour?.utilization).toBe(0.42);
    expect(quota.sevenDay?.utilization).toBe(0.10);
  });

  it('treats past reset as fresh utilization', () => {
    const now = Date.now();
    const window = { utilization: 0.99, resetMs: now - 1000 };
    expect(effectiveUtilization(window, now)).toBe(0);
  });

  it('flags near-quota at threshold', () => {
    const now = Date.now();
    const quota: QuotaState = {
      fiveHour: { utilization: 0.96, resetMs: now + 60_000 },
    };
    expect(isNearQuotaLimit(quota, 0.95, now)).toBe(true);
    expect(isNearQuotaLimit(quota, 0.97, now)).toBe(false);
  });

  it('ignores non-finite utilization', () => {
    const quota: QuotaState = {};
    expect(updateQuotaFromHeaders(quota, { 'anthropic-ratelimit-unified-5h-utilization': 'nan' })).toBe(
      false,
    );
    expect(quota.fiveHour).toBeUndefined();
  });
});
