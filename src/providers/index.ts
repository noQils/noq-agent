import 'dotenv/config';
import { Provider } from './base';
import { chat as ollamaChat } from './ollama';
import { chat as geminiChat } from './gemini';
import { chat as openAIChat } from './openai';

// Centralized provider management to allow easy switching between different LLM providers
const providerMap: Record<string, Provider> = {
    ollama: {
        chat: async (messages) => {
            const response = await ollamaChat(messages);
            return response;
        }
    },
    
    gemini: {
        chat: async (messages) => {
            const response = await geminiChat(messages);
            return response;
        }
    },

    openai: {
        chat: async (messages) => {
            const response = await openAIChat(messages);
            return response;
        }
    }
}

const providerName = process.env.AI_PROVIDER ?? 'ollama';
export const provider = providerMap[providerName];
if (!provider) throw new Error(`Unknown provider: ${providerName}`);
