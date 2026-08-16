/** Session key for affinity pins — mirrors teamclaude's metadata.user_id when present. */
export function extractSessionKey(body: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const metadata = parsed.metadata;
    if (metadata && typeof metadata === 'object') {
      const userId = (metadata as Record<string, unknown>).user_id;
      if (typeof userId === 'string' && userId.trim()) {
        return userId.trim();
      }
    }
    const messages = parsed.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0];
      if (first && typeof first === 'object') {
        const content = (first as Record<string, unknown>).content;
        if (typeof content === 'string' && content.trim()) {
          return content.slice(0, 64);
        }
      }
    }
  } catch {
    /* non-JSON body — no affinity key */
  }
  return undefined;
}

export const PIN_TTL_MS = 15 * 60 * 1000;

export class SessionAffinity {
  private pins = new Map<string, { accountName: string; expiresAt: number }>();

  pin(sessionKey: string, accountName: string, nowMs = Date.now()): void {
    this.pins.set(sessionKey, { accountName, expiresAt: nowMs + PIN_TTL_MS });
  }

  lookup(sessionKey: string | undefined, nowMs = Date.now()): string | undefined {
    if (!sessionKey) {
      return undefined;
    }
    const entry = this.pins.get(sessionKey);
    if (!entry) {
      return undefined;
    }
    if (nowMs >= entry.expiresAt) {
      this.pins.delete(sessionKey);
      return undefined;
    }
    return entry.accountName;
  }
}
