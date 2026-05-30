import { getConfig } from '../config';
import { getLoadedEnvFiles, initializeRuntimeEnvironment } from '../runtimeEnv';
import { debugLog } from '../runtimeSettings';
import {
  buildMissingProviderError,
  getConfiguredProviderNames,
  getExplicitProviderNameSetting,
} from '../providerSettings';
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

function buildAmbiguousProviderError(configuredProviders: ProviderName[]): string {
  return [
    `Multiple providers are configured: ${configuredProviders.join(', ')}.`,
    'Set AI_PROVIDER (or defaultProvider in noq-agent.json / ~/.noq/config.json) to choose one explicitly.',
  ].join('\n');
}

export function resolveProviderName(): ProviderName {
  initializeRuntimeEnvironment();
  debugLog('Provider environment files loaded:', getLoadedEnvFiles());

  const explicitProviderName = getExplicitProviderNameSetting() ?? getConfig().defaultProvider;
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
