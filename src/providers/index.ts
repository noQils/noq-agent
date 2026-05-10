import 'dotenv/config';
import { Provider } from './base';
import { chat as ollamaChat } from './ollama';
import { chat as geminiChat } from './gemini';

// Centralized provider management to allow easy switching between different LLM providers
const providerMap: Record<string, Provider> = {
    ollama: {
        generateText: async (prompt: string) => {
            return (await ollamaChat([{ role: 'user', content: prompt }]));
        },
        chat: async (messages) => {
            const response = await ollamaChat(messages);
            return {
                text: response,
            };
        }
    },
    
    gemini: {
        generateText: async (prompt: string) => {
            throw new Error('generateText is not implemented for Gemini. Use chat instead.');
        },
        chat: async (messages) => {
            const response = await geminiChat(messages);
            return {
                text: response,
            };
        }
    }
}

const providerName = process.env.AI_PROVIDER ?? 'ollama';
export const provider = providerMap[providerName];
if (!provider) throw new Error(`Unknown provider: ${providerName}`);
