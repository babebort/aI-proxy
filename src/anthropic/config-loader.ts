import { promises as fs } from 'node:fs';
import type { AnthropicPoolConfig } from './types.js';

export async function loadAnthropicPool(configFile: string): Promise<AnthropicPoolConfig> {
  const raw = JSON.parse(await fs.readFile(configFile, 'utf8')) as Record<string, unknown>;
  const upstream =
    typeof raw.upstream === 'string' && raw.upstream.trim()
      ? raw.upstream.trim()
      : 'https://api.anthropic.com';
  const switchThreshold =
    typeof raw.switchThreshold === 'number' && raw.switchThreshold > 0
      ? raw.switchThreshold
      : 0.95;
  const sessionAffinity = raw.sessionAffinity !== false;
  const accounts: AnthropicPoolConfig['accounts'] = [];
  if (Array.isArray(raw.accounts)) {
    for (const item of raw.accounts) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const row = item as Record<string, unknown>;
      if (typeof row.name !== 'string' || typeof row.accessToken !== 'string') {
        continue;
      }
      accounts.push({
        name: row.name,
        accessToken: row.accessToken,
        type: typeof row.type === 'string' ? row.type : undefined,
        refreshToken: typeof row.refreshToken === 'string' ? row.refreshToken : undefined,
        expiresAt: typeof row.expiresAt === 'number' ? row.expiresAt : undefined,
        disabled: row.disabled === true,
        priority: typeof row.priority === 'number' ? row.priority : undefined,
        accountUuid: typeof row.accountUuid === 'string' ? row.accountUuid : undefined,
      });
    }
  }
  return {
    upstream: upstream.replace(/\/$/, ''),
    switchThreshold,
    sessionAffinity,
    accounts,
  };
}
