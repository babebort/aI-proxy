import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OPENAI_GID } from './paths.js';

describe('paths', () => {
  it('has stable default openai gid', () => {
    assert.match(DEFAULT_OPENAI_GID, /^[a-f0-9]{64}$/);
  });
});
