import { getAuthStorePath, getGlobalConfigPath } from './noqHome';
import { loadAuthStore } from './authStore';
import { getConfig } from './config';
import { getLoadedEnvFiles, getRuntimeEnvVar, initializeRuntimeEnvironment } from './runtimeEnv';
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
  initializeRuntimeEnvironment();
  return getConfiguredStringValue(
    getRuntimeEnvVar('AI_PROVIDER'),
    getConfig().defaultProvider,
  );
}

export function getProviderSettings(providerName: ProviderName): ProviderSettings {
  initializeRuntimeEnvironment();
  const authStore = loadAuthStore();
  const authRecord = authStore[providerName];

  switch (providerName) {
    case 'openai': {
      const settings: ProviderSettings = {};
      const apiKey = getConfiguredStringValue(
        getRuntimeEnvVar('OPENAI_API_KEY'),
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getRuntimeEnvVar('OPENAI_MODEL'),
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
        getRuntimeEnvVar('OPENROUTER_API_KEY'),
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getRuntimeEnvVar('OPENROUTER_MODEL'),
        getDefaultModelForProvider('openrouter'),
      );
      const httpReferer = getConfiguredStringValue(
        getRuntimeEnvVar('OPENROUTER_HTTP_REFERER'),
        authRecord?.httpReferer,
      );
      const appTitle = getConfiguredStringValue(
        getRuntimeEnvVar('OPENROUTER_APP_TITLE'),
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
        getRuntimeEnvVar('GEMINI_API_KEY'),
        authRecord?.apiKey,
      );
      const model = getConfiguredStringValue(
        getRuntimeEnvVar('GEMINI_MODEL'),
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
        getRuntimeEnvVar('OLLAMA_BASE_URL'),
        authRecord?.baseUrl,
      );
      const model = getConfiguredStringValue(
        getRuntimeEnvVar('OLLAMA_DEFAULT_MODEL'),
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
  const loadedEnvFiles = getLoadedEnvFiles();
  const loadedFileLines = loadedEnvFiles.length > 0
    ? loadedEnvFiles.map((filePath) => `- ${filePath}`).join('\n')
    : '- none';

  return [
    'No AI provider is configured.',
    '',
    'Set AI_PROVIDER explicitly, or configure exactly one provider with its required model variables.',
    '',
    'Recognized provider settings:',
    '- OpenAI: OPENAI_API_KEY + OPENAI_MODEL, or ~/.noq/auth.json + defaultModel',
    '- OpenRouter: OPENROUTER_API_KEY + OPENROUTER_MODEL, or ~/.noq/auth.json + defaultModel',
    '- Gemini: GEMINI_API_KEY + GEMINI_MODEL, or ~/.noq/auth.json + defaultModel',
    '- Ollama: OLLAMA_DEFAULT_MODEL',
    '',
    `Global config path: ${getGlobalConfigPath()}`,
    `Global auth path: ${getAuthStorePath()}`,
    '',
    'Environment files loaded for noq:',
    loadedFileLines,
  ].join('\n');
}

export function getProviderModelSetting(
  providerName: ProviderName,
  explicitModel?: string,
): string | undefined {
  return explicitModel ?? getProviderSettings(providerName).model;
}
