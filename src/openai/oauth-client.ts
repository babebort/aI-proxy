import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_ISSUER = 'https://auth.openai.com';
export const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const DEFAULT_REDIRECT_URI = 'http://localhost:1455/auth/callback';

export interface OAuthSession {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  upstream_api_key?: string;
  chatgpt_account_id?: string;
  token_type?: string;
  client_id?: string;
  expires_at?: number;
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function randomUrlToken(size: number): string {
  return randomBytes(size).toString('base64url');
}

export function createOAuthClient() {
  const issuer = envOrDefault('OPENAI_OAUTH_ISSUER', DEFAULT_ISSUER);
  const clientId = envOrDefault('OPENAI_OAUTH_CLIENT_ID', DEFAULT_CLIENT_ID);
  const redirectUri = envOrDefault('OPENAI_OAUTH_REDIRECT_URI', DEFAULT_REDIRECT_URI);

  return {
    issuer,
    clientId,
    redirectUri,
    generateAuthUrl(): { session: OAuthSession; authUrl: string } {
      const verifier = randomUrlToken(48);
      const state = randomUrlToken(32);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const session: OAuthSession = {
        state,
        codeVerifier: verifier,
        redirectUri,
        clientId,
      };
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope:
          'openid profile email offline_access api.connectors.read api.connectors.invoke',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
        state,
      });
      const authUrl = `${issuer.replace(/\/$/, '')}/oauth/authorize?${params.toString()}`;
      return { session, authUrl };
    },

    async exchangeCode(session: OAuthSession, code: string): Promise<TokenSet> {
      const tokens = await postTokenForm(issuer, {
        grant_type: 'authorization_code',
        code: code.trim(),
        redirect_uri: session.redirectUri,
        client_id: session.clientId,
        code_verifier: session.codeVerifier,
      });
      tokens.client_id = session.clientId;
      if (tokens.id_token) {
        tokens.chatgpt_account_id = chatGptAccountIdFromIdToken(tokens.id_token);
        try {
          const exchanged = await postTokenForm(issuer, {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            client_id: session.clientId,
            requested_token: 'openai-api-key',
            subject_token: tokens.id_token,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
          });
          tokens.upstream_api_key = exchanged.access_token;
        } catch {
          // optional upstream key exchange
        }
      }
      return tokens;
    },
  };
}

async function postTokenForm(
  issuer: string,
  form: Record<string, string>,
): Promise<TokenSet> {
  const res = await fetch(`${issuer.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`oauth token endpoint returned ${res.status}: ${text.trim().slice(0, 512)}`);
  }
  const raw = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!raw.access_token?.trim()) {
    throw new Error('oauth token response missing access_token');
  }
  const expiresIn = raw.expires_in && raw.expires_in > 0 ? raw.expires_in : 3600;
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    id_token: raw.id_token,
    token_type: raw.token_type,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  };
}

export function chatGptAccountIdFromIdToken(idToken: string): string | undefined {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    for (const key of ['chatgpt_account_id', 'organization_id']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseCodeInput(input: string): { code: string; state: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('oauth code is required');
  }
  if (trimmed.includes('://')) {
    const parsed = new URL(trimmed);
    const code = parsed.searchParams.get('code')?.trim() ?? '';
    const state = parsed.searchParams.get('state')?.trim() ?? '';
    if (!code) {
      throw new Error('callback URL missing code');
    }
    return { code, state };
  }
  return { code: trimmed, state: '' };
}
