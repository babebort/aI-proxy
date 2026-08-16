import { loadAnthropicPool } from '../anthropic/config-loader.js';
import { probeAllAnthropicAccounts, probeAnthropicAccount } from '../anthropic/quota-probe.js';
import type { AnthropicAccount } from '../anthropic/types.js';
import { loadConfig, loadCodexerAccounts, readCodexerGroupApi } from '../config.js';
import { parseOpenAiJwtMeta } from '../openai/jwt-meta.js';
import { probeAllOpenAiAccounts, probeOpenAiAccount } from '../openai/quota-probe.js';
import { promises as fs } from 'node:fs';
import { parse } from 'yaml';

interface RawCodexerUser {
  uuid?: string;
  alias?: string;
  tokens?: {
    access_token?: string;
    id_token?: string;
    chatgpt_account_id?: string;
  };
}

export async function loadOpenAiProbeInputs(configFile: string) {
  const text = await fs.readFile(configFile, 'utf8');
  const doc = parse(text) as {
    groups?: Array<{ users?: RawCodexerUser[] }>;
  };
  const inputs = [];
  for (const group of doc.groups ?? []) {
    for (const user of group.users ?? []) {
      const accessToken = user.tokens?.access_token ?? '';
      const idToken = user.tokens?.id_token;
      const metaFromId = parseOpenAiJwtMeta(idToken);
      const metaFromAccess = parseOpenAiJwtMeta(accessToken);
      inputs.push({
        alias: user.alias ?? user.uuid ?? 'unknown',
        uuid: user.uuid ?? '',
        accessToken,
        idToken,
        chatgptAccountId:
          user.tokens?.chatgpt_account_id?.trim() ||
          metaFromId.chatgptAccountId ||
          metaFromAccess.chatgptAccountId,
      });
    }
  }
  return inputs;
}

export async function probeAccountsPayload(options?: {
  provider?: 'openai' | 'anthropic';
  id?: string;
}) {
  const config = await loadConfig();
  const openaiInputs = await loadOpenAiProbeInputs(config.openai.configFile).catch(() => []);
  const openaiAccounts = await loadCodexerAccounts(config.openai.configFile).catch(() => []);

  let anthropicPool: Awaited<ReturnType<typeof loadAnthropicPool>>['accounts'] = [];
  try {
    anthropicPool = (await loadAnthropicPool(config.anthropic.configFile)).accounts;
  } catch {
    // no config
  }

  const probeOne = options?.provider && options.id;
  let openai = probeOne && options.provider !== 'openai'
    ? []
    : probeOne
      ? await probeOneOpenAi(openaiInputs, options.id!)
      : await probeAllOpenAiAccounts(openaiInputs);
  let anthropic = probeOne && options.provider !== 'anthropic'
    ? []
    : probeOne
      ? await probeOneAnthropic(anthropicPool, options.id!)
      : await probeAllAnthropicAccounts(anthropicPool);

  const key =
    (await readCodexerGroupApi(config.openai.configFile)) ?? config.openai.apiKey ?? '';

  return {
    probedAt: new Date().toISOString(),
    openai,
    anthropic,
    openaiAccountCount: openaiAccounts.length,
    anthropicAccountCount: anthropicPool.length,
    single: probeOne ? { provider: options!.provider!, id: options!.id! } : undefined,
    env: {
      AI_PROXY_URL: `http://127.0.0.1:${config.unified.enabled ? config.unified.port : config.anthropic.port}`,
      OPENAI_API_KEY: key,
    },
  };
}

async function probeOneOpenAi(
  inputs: Awaited<ReturnType<typeof loadOpenAiProbeInputs>>,
  id: string,
) {
  const account = inputs.find((row) => row.uuid === id || row.alias === id);
  if (!account) {
    return [{ alias: id, uuid: id, ok: false, error: 'account not found' }];
  }
  return [await probeOpenAiAccount(account)];
}

async function probeOneAnthropic(accounts: AnthropicAccount[], name: string) {
  const account = accounts.find((row) => row.name === name);
  if (!account) {
    return [{ name, ok: false, error: 'account not found' }];
  }
  return [await probeAnthropicAccount(account)];
}
