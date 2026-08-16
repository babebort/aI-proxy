import { describe, expect, it } from 'vitest';
import { AccountManager } from './account-manager.js';
import { extractSessionKey, SessionAffinity } from './session.js';

describe('session affinity', () => {
  it('extracts metadata.user_id as session key', () => {
    const body = Buffer.from(JSON.stringify({ metadata: { user_id: 'conv-abc' }, messages: [] }));
    expect(extractSessionKey(body)).toBe('conv-abc');
  });

  it('pins and expires sessions', () => {
    const affinity = new SessionAffinity();
    const now = 1_000_000;
    affinity.pin('conv-1', 'acc-a', now);
    expect(affinity.lookup('conv-1', now + 1000)).toBe('acc-a');
    expect(affinity.lookup('conv-1', now + 16 * 60 * 1000)).toBeUndefined();
  });
});

describe('AccountManager selection', () => {
  it('skips accounts over switch threshold', async () => {
    const manager = new AccountManager('/dev/null');
    manager['poolConfig'] = {
      upstream: 'https://api.anthropic.com',
      switchThreshold: 0.95,
      sessionAffinity: true,
      accounts: [],
    };
    manager['runtime'].set('hot', {
      name: 'hot',
      accessToken: 't1',
      quota: { fiveHour: { utilization: 0.99, resetMs: Date.now() + 60_000 } },
    });
    manager['runtime'].set('cool', {
      name: 'cool',
      accessToken: 't2',
      quota: { fiveHour: { utilization: 0.1, resetMs: Date.now() + 60_000 } },
    });

    expect(manager.select()?.name).toBe('cool');
  });

  it('honours affinity pin when account is eligible', async () => {
    const manager = new AccountManager('/dev/null');
    manager['poolConfig'] = {
      upstream: 'https://api.anthropic.com',
      switchThreshold: 0.95,
      sessionAffinity: true,
      accounts: [],
    };
    for (const name of ['a', 'b']) {
      manager['runtime'].set(name, {
        name,
        accessToken: `t-${name}`,
        quota: {},
      });
    }
    manager.pinSession('conv-x', 'b');
    expect(manager.select('conv-x')?.name).toBe('b');
  });
});
