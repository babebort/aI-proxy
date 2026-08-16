import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { parse, stringify } from 'yaml';
import {
  DEFAULT_OPENAI_GID,
  defaultAnthropicConfig,
  defaultCodexerConfig,
  supervisorConfigPath,
} from './paths.js';
import { parseOpenAiJwtMeta } from './openai/jwt-meta.js';

export interface OpenAiConfig {
  port: number;
  configFile: string;
  gid: string;
  /** Bearer clients send to http://127.0.0.1:<port>/v1/... */
  apiKey: string | null;
}

export interface AnthropicConfig {
  port: number;
  configFile: string;
  /** Optional gate for /_tcr/ control routes; request path exempts loopback. */
  apiKey: string | null;
  /** Model for quota probe (count_tokens). */
  probeModel?: string;
  /** Extended thinking in probe request — affects quota headers. */
  probeReasoning?: AnthropicProbeReasoning;
}

export type AnthropicProbeReasoning = 'off' | 'low' | 'medium' | 'high';

export interface IntegrationsConfig {
  smspool?: {
    /** SMSPool dashboard → Settings → API key (32 chars). */
    apiKey?: string | null;
  };
}

export interface SupervisorConfig {
  unified: UnifiedConfig;
  openai: OpenAiConfig;
  anthropic: AnthropicConfig;
  integrations?: IntegrationsConfig;
}

export interface UnifiedConfig {
  /** Single public listener (OpenAI + Anthropic routes). */
  port: number;
  enabled: boolean;
}

const DEFAULTS: SupervisorConfig = {
  unified: {
    port: 8787,
    enabled: true,
  },
  openai: {
    port: 9090,
    configFile: defaultCodexerConfig(),
    gid: DEFAULT_OPENAI_GID,
    apiKey: null,
  },
  anthropic: {
    port: 3456,
    configFile: defaultAnthropicConfig(),
    apiKey: null,
  },
};

function mergeConfig(raw: unknown): SupervisorConfig {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const openai = (doc.openai ?? {}) as Partial<OpenAiConfig>;
  const anthropic = (doc.anthropic ?? {}) as Partial<AnthropicConfig>;
  const unified = (doc.unified ?? {}) as Partial<UnifiedConfig>;
  const integrations = (doc.integrations ?? {}) as IntegrationsConfig;
  return {
    unified: { ...DEFAULTS.unified, ...unified },
    openai: { ...DEFAULTS.openai, ...openai },
    anthropic: { ...DEFAULTS.anthropic, ...anthropic },
    integrations: { ...integrations },
  };
}

export async function loadConfig(): Promise<SupervisorConfig> {
  try {
    const text = await fs.readFile(supervisorConfigPath(), 'utf8');
    return mergeConfig(parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULTS };
    }
    throw error;
  }
}

export async function saveConfig(config: SupervisorConfig): Promise<void> {
  const dir = supervisorConfigPath().replace(/\/[^/]+$/, '');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const body = stringify(config);
  await fs.writeFile(supervisorConfigPath(), body, { mode: 0o600 });
}

/** First-run: write ~/.config/ai-proxy/config.yml with generated proxy keys. */
export async function ensureConfig(): Promise<SupervisorConfig> {
  let config = await loadConfig();
  let dirty = false;

  if (!config.openai.apiKey) {
    config = {
      ...config,
      openai: { ...config.openai, apiKey: `aip-openai-${randomBytes(24).toString('hex')}` },
    };
    dirty = true;
  }
  if (!config.anthropic.apiKey) {
    config = {
      ...config,
      anthropic: {
        ...config.anthropic,
        apiKey: `aip-anthropic-${randomBytes(24).toString('hex')}`,
      },
    };
    dirty = true;
  }

  if (dirty) {
    await saveConfig(config);
  }
  return config;
}

export async function readCodexerGroupApi(configFile: string): Promise<string | null> {
  try {
    const text = await fs.readFile(configFile, 'utf8');
    const doc = parse(text) as { groups?: Array<{ api?: string }> };
    return doc.groups?.[0]?.api ?? null;
  } catch {
    return null;
  }
}

export interface CodexerAccount {
  groupName: string;
  gid: string;
  uuid: string;
  alias: string;
  hasToken: boolean;
  email?: string;
  planType?: string;
}

export async function loadCodexerAccounts(configFile: string): Promise<CodexerAccount[]> {
  const text = await fs.readFile(configFile, 'utf8');
  const doc = parse(text) as {
    groups?: Array<{
      gname?: string;
      gid?: string;
      users?: Array<{
        uuid?: string;
        alias?: string;
        tokens?: { access_token?: string; id_token?: string };
      }>;
    }>;
  };
  const accounts: CodexerAccount[] = [];
  for (const group of doc.groups ?? []) {
    const groupName = group.gname ?? '';
    const gid = group.gid ?? '';
    for (const user of group.users ?? []) {
      const meta = parseOpenAiJwtMeta(user.tokens?.id_token ?? user.tokens?.access_token);
      accounts.push({
        groupName,
        gid,
        uuid: user.uuid ?? '',
        alias: user.alias ?? '',
        hasToken: Boolean(user.tokens?.access_token),
        email: meta.email,
        planType: meta.planType,
      });
    }
  }
  return accounts;
}

export async function ensureAnthropicConfig(configFile: string, apiKey: string | null): Promise<void> {
  try {
    await fs.access(configFile);
    if (apiKey) {
      const raw = JSON.parse(await fs.readFile(configFile, 'utf8')) as Record<string, unknown>;
      const proxy = (raw.proxy ?? {}) as Record<string, unknown>;
      if (!proxy.apiKey) {
        raw.proxy = { ...proxy, apiKey };
        await fs.writeFile(configFile, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
      }
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const dir = pathDirname(configFile);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const seed = {
    proxy: { port: DEFAULTS.anthropic.port, ...(apiKey ? { apiKey } : {}) },
    upstream: 'https://api.anthropic.com',
    switchThreshold: 0.95,
    sessionAffinity: true,
    accounts: [],
  };
  await fs.writeFile(configFile, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
}

function pathDirname(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx >= 0 ? file.slice(0, idx) : '.';
}
