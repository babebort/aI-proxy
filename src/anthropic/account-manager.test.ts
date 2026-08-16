import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccountManager } from './account-manager.js';
import { extractSessionKey, SessionAffinity } from './session.js';

describe('session affinity', () => {
  it('extracts metadata.user_id as session key', () => {
    const body = Buffer.from(JSON.stringify({ metadata: { user_id: 'conv-abc' }, messages: [] }));
    assert.equal(extractSessionKey(body), 'conv-abc');
  });

  it('pins and expires sessions', () => {
    const affinity = new SessionAffinity();
    const now = 1_000_000;
    affinity.pin('conv-1', 'acc-a', now);
    assert.equal(affinity.lookup('conv-1', now + 1000), 'acc-a');
    assert.equal(affinity.lookup('conv-1', now + 16 * 60 * 1000), undefined);
  });
});

describe('AccountManager selection', () => {
  it('skips accounts over switch threshold', () => {
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

    assert.equal(manager.select()?.name, 'cool');
  });

  it('honours affinity pin when account is eligible', () => {
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
    assert.equal(manager.select('conv-x')?.name, 'b');
  });
});
