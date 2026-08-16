import type { AnthropicAccount } from './types.js';

export class AccountPool {
  private index = 0;

  constructor(private accounts: AnthropicAccount[]) {}

  eligible(): AnthropicAccount[] {
    return this.accounts
      .filter((a) => !a.disabled && a.accessToken.trim())
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /** Round-robin pick; skips skipName when alternatives exist. */
  next(skipName?: string): AnthropicAccount | null {
    const list = this.eligible();
    if (list.length === 0) {
      return null;
    }
    const start = this.index % list.length;
    for (let i = 0; i < list.length; i += 1) {
      const idx = (start + i) % list.length;
      const account = list[idx]!;
      if (skipName && account.name === skipName && list.length > 1) {
        continue;
      }
      this.index = (idx + 1) % list.length;
      return account;
    }
    return list[0] ?? null;
  }

  size(): number {
    return this.eligible().length;
  }
}
