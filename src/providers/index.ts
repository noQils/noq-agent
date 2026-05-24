import { getConfig } from '../config';
import { getLoadedEnvFiles, getRuntimeEnvVar, initializeRuntimeEnvironment } from '../runtimeEnv';
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

  const explicitProviderName = getRuntimeEnvVar('AI_PROVIDER') ?? getConfig().defaultProvider;
  if (explicitProviderName) {
    if (!isProviderName(explicitProviderName)) {
      throw new Error(
        `Unknown provider "${explicitProviderName}". Expected one of: ${providerNames.join(', ')}.`,
      );
    }

    return explicitProviderName;
  }

  const configuredProviders = getConfiguredProviderNames();
  if (configuredProviders.length === 0) {
    throw new Error(buildMissingProviderError());
  }

  if (configuredProviders.length > 1) {
    throw new Error(buildAmbiguousProviderError(configuredProviders));
  }

  return configuredProviders[0]!;
}

export function getProvider(): Provider {
  const providerName = resolveProviderName();
  return providerMap[providerName];
}
