export const TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const EXPIRING_SOON_MS = 5 * 60 * 1000;

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type OAuthRefreshError =
  | { kind: 'auth_rejected'; status: number }
  | { kind: 'transient'; message: string };

export function normalizeExpiresAt(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function expiresAtFrom(nowMs: number, expiresInSeconds?: number): number {
  const seconds = expiresInSeconds ?? 3600;
  return nowMs + Math.min(seconds, 86_400) * 1000;
}

export function isExpired(expiresAtMs: number | undefined, nowMs: number): boolean {
  if (expiresAtMs === undefined) {
    return false;
  }
  return nowMs >= expiresAtMs;
}

export function isExpiringSoon(expiresAtMs: number | undefined, nowMs: number): boolean {
  if (expiresAtMs === undefined) {
    return false;
  }
  return nowMs + EXPIRING_SOON_MS >= expiresAtMs;
}

interface RefreshResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Refresh OAuth access token (single-use refresh token — caller must persist the new pair). */
export async function refreshAccessToken(
  refreshToken: string,
  endpoint = TOKEN_ENDPOINT,
): Promise<RefreshedTokens | OAuthRefreshError> {
  const body = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken.trim(),
    client_id: CLIENT_ID,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/plain, */*',
          'user-agent': 'axios/1.13.6',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        continue;
      }
      return {
        kind: 'transient',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!response.ok) {
      const status = response.status;
      if (status >= 500 && attempt < MAX_RETRIES) {
        continue;
      }
      if (status === 400 || status === 401 || status === 403) {
        return { kind: 'auth_rejected', status };
      }
      const detail = (await response.text()).trim();
      return { kind: 'transient', message: `HTTP ${status}: ${detail}` };
    }

    const data = (await response.json()) as RefreshResponseBody;
    if (!data.access_token?.trim()) {
      return { kind: 'transient', message: 'refresh response missing access_token' };
    }

    const nowMs = Date.now();
    const expiresAt =
      data.expires_at !== undefined
        ? normalizeExpiresAt(data.expires_at)
        : expiresAtFrom(nowMs, data.expires_in);

    return {
      accessToken: data.access_token.trim(),
      refreshToken: data.refresh_token?.trim() || refreshToken.trim(),
      expiresAt,
    };
  }

  return { kind: 'transient', message: 'refresh retries exhausted' };
}
