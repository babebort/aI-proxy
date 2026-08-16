import { describe, expect, it } from 'vitest';
import { AccountPool } from './pool.js';

describe('AccountPool', () => {
  it('round-robins eligible accounts', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1' },
      { name: 'b', accessToken: 't2' },
    ]);
    expect(pool.next()?.name).toBe('a');
    expect(pool.next()?.name).toBe('b');
    expect(pool.next()?.name).toBe('a');
  });

  it('skips disabled accounts', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1', disabled: true },
      { name: 'b', accessToken: 't2' },
    ]);
    expect(pool.size()).toBe(1);
    expect(pool.next()?.name).toBe('b');
  });

  it('skips named account on retry when alternatives exist', () => {
    const pool = new AccountPool([
      { name: 'a', accessToken: 't1' },
      { name: 'b', accessToken: 't2' },
    ]);
    expect(pool.next('a')?.name).toBe('b');
  });
});
