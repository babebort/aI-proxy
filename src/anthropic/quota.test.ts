import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    assert.equal(read, true);
    assert.equal(quota.fiveHour?.utilization, 0.42);
    assert.equal(quota.sevenDay?.utilization, 0.10);
  });

  it('treats past reset as fresh utilization', () => {
    const now = Date.now();
    const window = { utilization: 0.99, resetMs: now - 1000 };
    assert.equal(effectiveUtilization(window, now), 0);
  });

  it('flags near-quota at threshold', () => {
    const now = Date.now();
    const quota: QuotaState = {
      fiveHour: { utilization: 0.96, resetMs: now + 60_000 },
    };
    assert.equal(isNearQuotaLimit(quota, 0.95, now), true);
    assert.equal(isNearQuotaLimit(quota, 0.97, now), false);
  });

  it('ignores non-finite utilization', () => {
    const quota: QuotaState = {};
    assert.equal(
      updateQuotaFromHeaders(quota, { 'anthropic-ratelimit-unified-5h-utilization': 'nan' }),
      false,
    );
    assert.equal(quota.fiveHour, undefined);
  });
});
