import { describe, expect, it } from 'vitest';
import { DEFAULT_OPENAI_GID } from './paths.js';

describe('paths', () => {
  it('has stable default openai gid', () => {
    expect(DEFAULT_OPENAI_GID).toMatch(/^[a-f0-9]{64}$/);
  });
});
