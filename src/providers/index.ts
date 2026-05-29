import { getConfig } from '../config';
import { getLoadedEnvFiles, getRuntimeEnvVar, initializeRuntimeEnvironment } from '../runtimeEnv';
import { debugLog } from '../runtimeSettings';
import { chat as geminiChat } from './gemini';
import { chat as ollamaChat } from './ollama';
import { chat as openAIChat } from './openai';
import { chat as openRouterChat } from './openrouter';
import { type Provider, providerNames, type ProviderName } from './types';

const providerMap: Record<ProviderName, Provider> = {
  ollama: { chat: ollamaChat },
  gemini: { chat: geminiChat },
  openai: { chat: openAIChat },
  openrouter: { chat: openRouterChat },
};

function isProviderName(value: string): value is ProviderName {
  return providerNames.includes(value as ProviderName);
}

function getConfiguredProviderNames(): ProviderName[] {
  initializeRuntimeEnvironment();

  const configuredProviders: ProviderName[] = [];
  if (getRuntimeEnvVar('OPENAI_API_KEY') && getRuntimeEnvVar('OPENAI_MODEL')) {
    configuredProviders.push('openai');
  }

  if (getRuntimeEnvVar('OPENROUTER_API_KEY') && getRuntimeEnvVar('OPENROUTER_MODEL')) {
    configuredProviders.push('openrouter');
  }

  if (getRuntimeEnvVar('GEMINI_API_KEY') && getRuntimeEnvVar('GEMINI_MODEL')) {
    configuredProviders.push('gemini');
  }

  if (getRuntimeEnvVar('OLLAMA_DEFAULT_MODEL')) {
    configuredProviders.push('ollama');
  }

  debugLog('Provider auto-detection candidates:', configuredProviders);
  return configuredProviders;
}

function buildMissingProviderError(): string {
  const loadedEnvFiles = getLoadedEnvFiles();
  const loadedFileLines = loadedEnvFiles.length > 0
    ? loadedEnvFiles.map((filePath) => `- ${filePath}`).join('\n')
    : '- none';

  return [
    'No AI provider is configured.',
    '',
    'Set AI_PROVIDER explicitly, or configure exactly one provider with its required model variables.',
    '',
    'Recognized provider variables:',
    '- OpenAI: OPENAI_API_KEY + OPENAI_MODEL',
    '- OpenRouter: OPENROUTER_API_KEY + OPENROUTER_MODEL',
    '- Gemini: GEMINI_API_KEY + GEMINI_MODEL',
    '- Ollama: OLLAMA_DEFAULT_MODEL',
    '',
    'Environment files loaded for noq:',
    loadedFileLines,
  ].join('\n');
}

function buildAmbiguousProviderError(configuredProviders: ProviderName[]): string {
  return [
    `Multiple providers are configured: ${configuredProviders.join(', ')}.`,
    'Set AI_PROVIDER (or defaultProvider in noq-agent.json) to choose one explicitly.',
  ].join('\n');
}

export function resolveProviderName(): ProviderName {
  initializeRuntimeEnvironment();
  debugLog('Provider environment files loaded:', getLoadedEnvFiles());

  const explicitProviderName = getRuntimeEnvVar('AI_PROVIDER') ?? getConfig().defaultProvider;
  if (explicitProviderName) {
    if (!isProviderName(explicitProviderName)) {
      throw new Error(
        `Unknown provider "${explicitProviderName}". Expected one of: ${providerNames.join(', ')}.`,
      );
    }

    debugLog('Provider selected explicitly:', explicitProviderName);
    return explicitProviderName;
  }

  const configuredProviders = getConfiguredProviderNames();
  if (configuredProviders.length === 0) {
    throw new Error(buildMissingProviderError());
  }

  if (configuredProviders.length > 1) {
    throw new Error(buildAmbiguousProviderError(configuredProviders));
  }

  const providerName = configuredProviders[0]!;
  debugLog('Provider selected automatically:', providerName);
  return providerName;
}

export function getProvider(): Provider {
  const providerName = resolveProviderName();
  debugLog('Using provider:', providerName);
  return providerMap[providerName];
}
