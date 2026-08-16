import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AccountPool } from './pool.js';

describe('AccountPool', () => {
  it('round-robins eligible accounts', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1' },
      { name: 'b', accessToken: 't2' },
    ]);
    assert.equal(pool.next()?.name, 'a');
    assert.equal(pool.next()?.name, 'b');
    assert.equal(pool.next()?.name, 'a');
  });

  it('skips disabled accounts', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1', disabled: true },
      { name: 'b', accessToken: 't2' },
    ]);
    assert.equal(pool.size(), 1);
    assert.equal(pool.next()?.name, 'b');
  });

  it('skips named account on retry when alternatives exist', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1' },
      { name: 'b', accessToken: 't2' },
    ]);
    assert.equal(pool.next('a')?.name, 'b');
  });
});
