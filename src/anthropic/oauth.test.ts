import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPIRING_SOON_MS,
  expiresAtFrom,
  isExpired,
  isExpiringSoon,
  normalizeExpiresAt,
} from './oauth.js';

describe('oauth helpers', () => {
  it('normalizes seconds to milliseconds', () => {
    assert.equal(normalizeExpiresAt(1_700_000_000), 1_700_000_000_000);
    assert.equal(normalizeExpiresAt(1_700_000_000_000), 1_700_000_000_000);
  });

  it('detects expiry and expiring-soon window', () => {
    const now = 1_000_000;
    const expires = now + EXPIRING_SOON_MS - 1;
    assert.equal(isExpired(expires, now), false);
    assert.equal(isExpiringSoon(expires, now), true);
    assert.equal(isExpired(now, now), true);
  });

  it('computes expiresAt from expires_in', () => {
    assert.equal(expiresAtFrom(1000, 3600), 1000 + 3600 * 1000);
  });
});
