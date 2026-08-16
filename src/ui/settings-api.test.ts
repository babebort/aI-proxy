import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupervisorConfig } from '../config.js';
import { buildSettingsPayload, maskSecret, resolveSmspoolApiKey } from './settings-api.js';

describe('settings-api', () => {
  it('maskSecret hides middle of key', () => {
    assert.match(maskSecret('abcdefghijklmnop') ?? '', /mnop$/);
    assert.equal(maskSecret(null), null);
  });

  it('resolveSmspoolApiKey prefers env', () => {
    const config = {
      integrations: { smspool: { apiKey: 'file-key' } },
    } as SupervisorConfig;
    const prev = process.env.SMSPOOL_API_KEY;
    process.env.SMSPOOL_API_KEY = 'env-key';
    try {
      assert.equal(resolveSmspoolApiKey(config), 'env-key');
    } finally {
      if (prev === undefined) {
        delete process.env.SMSPOOL_API_KEY;
      } else {
        process.env.SMSPOOL_API_KEY = prev;
      }
    }
  });

  it('buildSettingsPayload marks env source', () => {
    const prev = process.env.SMSPOOL_API_KEY;
    process.env.SMSPOOL_API_KEY = 'abc1234567890';
    try {
      const payload = buildSettingsPayload(
        { anthropic: {} } as SupervisorConfig,
        '/tmp/config.yml',
      );
      assert.equal(payload.smspool.source, 'env');
      assert.equal(payload.smspool.configured, true);
    } finally {
      if (prev === undefined) {
        delete process.env.SMSPOOL_API_KEY;
      } else {
        process.env.SMSPOOL_API_KEY = prev;
      }
    }
  });
});
