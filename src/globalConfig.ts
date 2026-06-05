import fs from 'node:fs';

import { type ProviderName } from './providers/types';
import { ensureNoqHomeDirectory, getGlobalConfigPath } from './noqHome';

export interface GlobalConfig {
  defaultProvider?: ProviderName;
  defaultModel?: string;
}

const providerNames: ProviderName[] = ['ollama', 'gemini', 'openai', 'openrouter'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readGlobalConfigFile(configPath: string): unknown {
  try {
    const rawConfig = fs.readFileSync(configPath, 'utf-8');
    if (rawConfig.trim().length === 0) {
      return {};
    }

    return JSON.parse(rawConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${configPath}: ${message}`);
  }
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function normalizeGlobalConfig(rawConfig: unknown, configPath: string): GlobalConfig {
  if (!isRecord(rawConfig)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }

  const defaultProvider = normalizeString(rawConfig.defaultProvider);
  const defaultModel = normalizeString(rawConfig.defaultModel);

  if (defaultProvider && !providerNames.includes(defaultProvider as ProviderName)) {
    throw new Error(`"defaultProvider" in ${configPath} must be one of: ${providerNames.join(', ')}.`);
  }

  return {
    ...(defaultProvider ? { defaultProvider: defaultProvider as ProviderName } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  };
}

export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  return normalizeGlobalConfig(readGlobalConfigFile(configPath), configPath);
}

export function saveGlobalConfig(config: GlobalConfig): void {
  ensureNoqHomeDirectory();
  fs.writeFileSync(getGlobalConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
