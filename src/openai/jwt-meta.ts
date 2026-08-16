export interface JwtAuthClaims {
  email?: string;
  planType?: string;
  chatgptAccountId?: string;
  name?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse OpenAI id_token / access_token JWT for display metadata. */
export function parseOpenAiJwtMeta(token: string | undefined): JwtAuthClaims {
  if (!token?.trim()) {
    return {};
  }
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return {};
  }

  const auth = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const profile = payload['https://api.openai.com/profile'] as Record<string, unknown> | undefined;

  let chatgptAccountId: string | undefined;
  for (const key of ['chatgpt_account_id', 'organization_id'] as const) {
    const top = payload[key];
    if (typeof top === 'string' && top.trim()) {
      chatgptAccountId = top.trim();
      break;
    }
  }
  if (!chatgptAccountId && typeof auth?.chatgpt_account_id === 'string' && auth.chatgpt_account_id.trim()) {
    chatgptAccountId = auth.chatgpt_account_id.trim();
  }

  return {
    email: typeof profile?.email === 'string' ? profile.email : typeof payload.email === 'string' ? payload.email : undefined,
    planType:
      typeof auth?.chatgpt_plan_type === 'string'
        ? auth.chatgpt_plan_type
        : typeof auth?.chatgpt_subscription_active === 'string'
          ? auth.chatgpt_subscription_active
          : undefined,
    chatgptAccountId,
    name: typeof profile?.name === 'string' ? profile.name : typeof payload.name === 'string' ? payload.name : undefined,
  };
}
