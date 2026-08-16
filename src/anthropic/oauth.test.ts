import { describe, expect, it } from 'vitest';
import {
  EXPIRING_SOON_MS,
  expiresAtFrom,
  isExpired,
  isExpiringSoon,
  normalizeExpiresAt,
} from './oauth.js';

describe('oauth helpers', () => {
  it('normalizes seconds to milliseconds', () => {
    expect(normalizeExpiresAt(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeExpiresAt(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('detects expiry and expiring-soon window', () => {
    const now = 1_000_000;
    const expires = now + EXPIRING_SOON_MS - 1;
    expect(isExpired(expires, now)).toBe(false);
    expect(isExpiringSoon(expires, now)).toBe(true);
    expect(isExpired(now, now)).toBe(true);
  });

  it('computes expiresAt from expires_in', () => {
    expect(expiresAtFrom(1000, 3600)).toBe(1000 + 3600 * 1000);
  });
});
