import { getAuthStorePath, getGlobalConfigPath } from './noqHome';
import { loadAuthStore } from './authStore';
import { getConfig } from './config';
import { providerNames, type ProviderName } from '../providers/types';

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
      openai: 'OpenAI',
      openrouter: 'OpenRouter',
      gemini: 'Gemini',
    };
    const providerLabel = providerLabelMap[providerName];

    throw new Error(
      `${providerLabel} credentials are not configured. ` +
      `Run /connect to save them into ${getAuthStorePath()}, then use /models to choose the active default provider and model.`,
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
    'This install now uses only ~/.noq/auth.json and ~/.noq/config.json for provider setup.',
    '',
    'To get started:',
    '- Run /connect to add at least one hosted provider API key to ~/.noq/auth.json',
    '- Run /models to choose the active default provider and model in ~/.noq/config.json',
    '- For Ollama, you can skip /connect and just run /models',
    '',
    'A provider is usable only when:',
    '- OpenAI/OpenRouter/Gemini: auth exists in ~/.noq/auth.json and the chosen default provider/model exists in ~/.noq/config.json',
    '- Ollama: the chosen default provider/model exists in ~/.noq/config.json',
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
