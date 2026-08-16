import type { AnthropicProbeReasoning, SupervisorConfig } from '../config.js';

export interface SettingsPayload {
  smspool: {
    configured: boolean;
    masked: string | null;
    source: 'env' | 'file' | 'none';
  };
  anthropicProbe: {
    model: string;
    reasoning: AnthropicProbeReasoning;
    models: readonly string[];
    reasoningOptions: readonly { id: AnthropicProbeReasoning; label: string }[];
  };
  configPath: string;
}

export function maskSecret(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  return `${'•'.repeat(Math.min(trimmed.length - 4, 12))}${trimmed.slice(-4)}`;
}

export function resolveSmspoolApiKey(config: SupervisorConfig): string | null {
  const fromEnv = process.env.SMSPOOL_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return config.integrations?.smspool?.apiKey?.trim() || null;
}

export function buildSettingsPayload(config: SupervisorConfig, configPath: string): SettingsPayload {
  const envKey = process.env.SMSPOOL_API_KEY?.trim();
  const fileKey = config.integrations?.smspool?.apiKey?.trim() || null;
  const activeKey = envKey || fileKey;
  const anthropic = config.anthropic ?? ({} as SupervisorConfig['anthropic']);

  return {
    smspool: {
      configured: Boolean(activeKey),
      masked: maskSecret(activeKey),
      source: envKey ? 'env' : fileKey ? 'file' : 'none',
    },
    anthropicProbe: {
      model: anthropic.probeModel ?? 'claude-haiku-4-5',
      reasoning: anthropic.probeReasoning ?? 'off',
      models: [
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-6',
        'claude-sonnet-5',
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
      ],
      reasoningOptions: [
        { id: 'off', label: 'Выкл' },
        { id: 'low', label: 'Low (4k thinking)' },
        { id: 'medium', label: 'Medium (8k thinking)' },
        { id: 'high', label: 'High (16k thinking)' },
      ],
    },
    configPath,
  };
}
