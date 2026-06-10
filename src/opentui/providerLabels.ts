import { type ProviderName } from '../providers/types';

export function formatProviderLabel(provider: ProviderName): string {
  if (provider === 'openai') {
    return 'OpenAI';
  }

  if (provider === 'openrouter') {
    return 'OpenRouter';
  }

  if (provider === 'ollama') {
    return 'Ollama';
  }

  return 'Gemini';
}
