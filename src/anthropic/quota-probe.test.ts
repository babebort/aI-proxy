import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasQuotaData, PROBE_MODELS } from './quota-probe.js';

describe('quota-probe', () => {
  it('lists current models with haiku first for cheap probes', () => {
    assert.ok(PROBE_MODELS.length >= 3);
    assert.match(PROBE_MODELS[0], /haiku/i);
    assert.doesNotMatch(PROBE_MODELS.join(','), /20250514/);
  });

  it('hasQuotaData detects unified windows and token limits', () => {
    assert.equal(hasQuotaData(undefined), false);
    assert.equal(hasQuotaData({}), false);
    assert.equal(hasQuotaData({ fiveHour: { utilization: 0.1 } }), true);
    assert.equal(hasQuotaData({ tokensLimit: 1000, tokensRemaining: 900 }), true);
  });
});
