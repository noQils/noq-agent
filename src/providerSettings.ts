import { getAuthStorePath, getGlobalConfigPath } from './noqHome';
import { loadAuthStore } from './authStore';
import { getConfig } from './config';
import { providerNames, type ProviderName } from './providers/types';

export interface ProviderSettings {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
}

function getDefaultModelForProvider(providerName: ProviderName): string | undefined {
  const config = getConfig();
  return config.defaultProvider === providerName
    ? config.defaultModel
    : undefined;
}

function getConfiguredStringValue(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

export function getExplicitProviderNameSetting(): string | undefined {
  return getConfig().defaultProvider;
}

export function getProviderSettings(providerName: ProviderName): ProviderSettings {
  const authStore = loadAuthStore();
  const authRecord = authStore[providerName];

  switch (providerName) {
    case 'openai': {
      const settings: ProviderSettings = {};
      const apiKey = getConfiguredStringValue(
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getDefaultModelForProvider('openai'),
      );

      if (apiKey) {
        settings.apiKey = apiKey;
      }

      if (model) {
        settings.model = model;
      }

      return settings;
    }

    case 'openrouter': {
      const settings: ProviderSettings = {};
      const apiKey = getConfiguredStringValue(
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getDefaultModelForProvider('openrouter'),
      );
      const httpReferer = getConfiguredStringValue(
        authRecord?.httpReferer,
      );
      const appTitle = getConfiguredStringValue(
        authRecord?.appTitle,
      );

      if (apiKey) {
        settings.apiKey = apiKey;
      }

      if (model) {
        settings.model = model;
      }

      if (httpReferer) {
        settings.httpReferer = httpReferer;
      }

      if (appTitle) {
        settings.appTitle = appTitle;
      }

      return settings;
    }

    case 'gemini': {
      const settings: ProviderSettings = {};
      const apiKey = getConfiguredStringValue(
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getDefaultModelForProvider('gemini'),
      );

      if (apiKey) {
        settings.apiKey = apiKey;
      }

      if (model) {
        settings.model = model;
      }

      return settings;
    }

    case 'ollama': {
      const settings: ProviderSettings = {};
      const baseUrl = getConfiguredStringValue(
        authRecord?.baseUrl,
      );
      const model = getConfiguredStringValue(
        getDefaultModelForProvider('ollama'),
      );

      if (baseUrl) {
        settings.baseUrl = baseUrl;
      }

      if (model) {
        settings.model = model;
      }

      return settings;
    }
  }
}

export function getRequiredProviderApiKey(providerName: Exclude<ProviderName, 'ollama'>): string {
  const apiKey = getProviderSettings(providerName).apiKey;
  if (!apiKey) {
    const providerLabelMap: Record<Exclude<ProviderName, 'ollama'>, string> = {
      openai: 'OPENAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      gemini: 'GEMINI_API_KEY',
    };
    const envLabel = providerLabelMap[providerName];

    throw new Error(
      `${envLabel} is not configured. ` +
      `Set it in your shell environment, one of the loaded env files, or ${getAuthStorePath()}.`,
    );
  }

  return apiKey;
}

export function getConfiguredProviderNames(): ProviderName[] {
  return providerNames.filter((providerName) => {
    const settings = getProviderSettings(providerName);

    if (providerName === 'ollama') {
      return Boolean(settings.model);
    }

    return Boolean(settings.apiKey && settings.model);
  });
}

export function buildMissingProviderError(): string {
  return [
    'No AI provider is configured.',
    '',
    'Configure at least one provider in ~/.noq/auth.json and choose a default provider/model in ~/.noq/config.json.',
    '',
    'Setup paths:',
    '- Run /connect to save provider credentials into ~/.noq/auth.json',
    '- Run /models to choose the global default provider/model in ~/.noq/config.json',
    '- Ollama only needs /models unless you also want to set a custom base URL',
    '',
    `Global config path: ${getGlobalConfigPath()}`,
    `Global auth path: ${getAuthStorePath()}`,
  ].join('\n');
}

export function getProviderModelSetting(
  providerName: ProviderName,
  explicitModel?: string,
): string | undefined {
  return explicitModel ?? getProviderSettings(providerName).model;
}
