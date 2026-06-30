import OpenAI from 'openai';
import { Ollama } from 'ollama';

import { loadAuthStore, saveAuthStore, type ProviderAuthRecord } from './config/authStore';
import { resetConfigCache } from './config/config';
import { loadGlobalConfig, saveGlobalConfig } from './config/globalConfig';
import { getAuthStorePath, getGlobalConfigPath } from './config/noqHome';
import { getConfiguredProviderNames, getProviderSettings } from './config/providerSettings';
import { providerNames, type ProviderName } from './providers/types';

export const connectProviderChoices: ProviderName[] = [...providerNames];

export const modelPresets: Record<ProviderName, string[]> = {
  openai: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4.1-mini'],
  openrouter: ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-flash'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  ollama: ['llama3.1:8b', 'qwen2.5-coder:7b', 'deepseek-r1:8b'],
};

export interface ModelChoicesResult {
  models: string[];
  source: 'live' | 'fallback';
}

const modelChoiceCacheTtlMs = 5 * 60 * 1000;
const modelChoiceCache = new Map<ProviderName, { expiresAt: number; models: string[] }>();

function sortModelIds(modelIds: string[]): string[] {
  return [...modelIds].sort((left, right) => left.localeCompare(right));
}

function normalizeDiscoveredModelIds(modelIds: string[]): string[] {
  return sortModelIds(
    Array.from(
      new Set(
        modelIds
          .map((modelId) => modelId.trim())
          .filter((modelId) => modelId.length > 0),
      ),
    ),
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return await response.json() as T;
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const client = new OpenAI({ apiKey, maxRetries: 1 });
  const page = await client.models.list();
  return normalizeDiscoveredModelIds(page.data.map((model) => model.id));
}

async function fetchOpenRouterModels(apiKey?: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchJson<{ data?: Array<{ id?: string }> }>(
    'https://openrouter.ai/api/v1/models',
    { headers },
  );

  return normalizeDiscoveredModelIds(
    (response.data ?? []).flatMap((model) => typeof model.id === 'string' ? [model.id] : []),
  );
}

async function fetchDeepSeekModels(apiKey: string): Promise<string[]> {
  const response = await fetchJson<{ data?: Array<{ id?: string }> }>(
    'https://api.deepseek.com/models',
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );

  return normalizeDiscoveredModelIds(
    (response.data ?? []).flatMap((model) => typeof model.id === 'string' ? [model.id] : []),
  );
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const discoveredModels: string[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetchJson<{
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    }>(url.toString());

    for (const model of response.models ?? []) {
      if (!model.name || !model.supportedGenerationMethods?.includes('generateContent')) {
        continue;
      }

      discoveredModels.push(model.name.replace(/^models\//, ''));
    }

    pageToken = response.nextPageToken;
  } while (pageToken);

  return normalizeDiscoveredModelIds(discoveredModels);
}

async function fetchOllamaModels(baseUrl?: string): Promise<string[]> {
  const client = new Ollama(baseUrl ? { host: baseUrl } : undefined);
  const response = await client.list();
  return normalizeDiscoveredModelIds(
    (response.models ?? []).flatMap((model) => typeof model.model === 'string' ? [model.model] : []),
  );
}

async function discoverProviderModels(providerName: ProviderName): Promise<string[]> {
  const settings = getProviderSettings(providerName);

  switch (providerName) {
    case 'openai':
      if (!settings.apiKey) {
        throw new Error('OpenAI is not connected yet.');
      }
      return await fetchOpenAIModels(settings.apiKey);

    case 'openrouter':
      return await fetchOpenRouterModels(settings.apiKey);

    case 'deepseek':
      if (!settings.apiKey) {
        throw new Error('DeepSeek is not connected yet.');
      }
      return await fetchDeepSeekModels(settings.apiKey);

    case 'gemini':
      if (!settings.apiKey) {
        throw new Error('Gemini is not connected yet.');
      }
      return await fetchGeminiModels(settings.apiKey);

    case 'ollama':
      return await fetchOllamaModels(settings.baseUrl);
  }
}

export async function getModelChoices(providerName: ProviderName): Promise<ModelChoicesResult> {
  const cached = modelChoiceCache.get(providerName);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      models: cached.models,
      source: 'live',
    };
  }

  try {
    const models = await discoverProviderModels(providerName);
    if (models.length > 0) {
      modelChoiceCache.set(providerName, {
        expiresAt: Date.now() + modelChoiceCacheTtlMs,
        models,
      });

      return {
        models,
        source: 'live',
      };
    }
  } catch {
    // Fall back to curated presets below.
  }

  return {
    models: modelPresets[providerName],
    source: 'fallback',
  };
}

export function formatProviderChoiceList(providers: ProviderName[]): string {
  return providers
    .map((providerName, index) => `${index + 1}. ${providerName}`)
    .join('\n');
}

export function getModelProviderChoices(): ProviderName[] {
  const configured = new Set(getConfiguredProviderNames());
  const prioritized = providerNames.filter((providerName) => configured.has(providerName));
  const remaining = providerNames.filter((providerName) => !configured.has(providerName));
  return [...prioritized, ...remaining];
}

export function parseProviderChoice(
  input: string,
  providers: ProviderName[],
): ProviderName | null {
  const normalizedInput = input.trim().toLowerCase();
  if (normalizedInput.length === 0) {
    return null;
  }

  const numericChoice = Number(normalizedInput);
  if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= providers.length) {
    return providers[numericChoice - 1] ?? null;
  }

  return providers.find((providerName) => providerName === normalizedInput) ?? null;
}

export function parseModelChoice(
  input: string,
  presetCount: number,
): 'custom' | number | null {
  const normalizedInput = input.trim().toLowerCase();
  if (normalizedInput.length === 0) {
    return null;
  }

  if (normalizedInput === 'custom' || normalizedInput === 'c') {
    return 'custom';
  }

  const numericChoice = Number(normalizedInput);
  if (!Number.isInteger(numericChoice) || numericChoice < 1 || numericChoice > presetCount + 1) {
    return null;
  }

  return numericChoice === presetCount + 1 ? 'custom' : numericChoice - 1;
}

export function formatModelChoiceList(models: string[]): string {
  return [
    ...models.map((modelId, index) => `${index + 1}. ${modelId}`),
    `${models.length + 1}. custom`,
  ].join('\n');
}

export function saveProviderConnection(
  providerName: ProviderName,
  authRecord: ProviderAuthRecord,
): string {
  const authStore = loadAuthStore();
  authStore[providerName] = authRecord;
  saveAuthStore(authStore);
  return getAuthStorePath();
}

export function saveGlobalModelSelection(
  providerName: ProviderName,
  model: string,
): string {
  const globalConfig = loadGlobalConfig();
  saveGlobalConfig({
    ...globalConfig,
    defaultProvider: providerName,
    defaultModel: model,
  });
  resetConfigCache();
  return getGlobalConfigPath();
}
