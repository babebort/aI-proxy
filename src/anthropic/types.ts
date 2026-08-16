export interface AnthropicAccount {
  name: string;
  type?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  disabled?: boolean;
  priority?: number;
  accountUuid?: string;
}

export interface AnthropicPoolConfig {
  upstream: string;
  switchThreshold: number;
  accounts: AnthropicAccount[];
}

export const RETRY_STATUS = new Set([429, 529, 502, 503]);
