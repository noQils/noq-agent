import ollama, {
    type Message,
} from 'ollama';
import { 
  type ChatMessage, 
  type ChatResult,
  type ExecutedToolCall,
} from './base';
import { allTools, type InternalTool } from '../tools';
import { getDefaultSystemPrompt } from '../systemPrompt';

// Helper function to convert internal tool definitions to the format expected by Ollama
function toOllamaTool(internalTools: InternalTool[]) {
  return internalTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([name, value]) => [
            name,
            {
              type: value.type,
              description: value.description,
            },
          ])
        ),
        required: Object.entries(tool.parameters.properties)
            .filter(([, value]) => value.required)
            .map(([name]) => name),
      }
    }
  }));
}

// Main chat function to interact with the Ollama model, handling messages and tool calls
export async function chat(
  messages: ChatMessage[],
  config?: { model?: string }
): Promise<ChatResult> {

    const model = config?.model ?? process.env.OLLAMA_DEFAULT_MODEL;
    if (!model) {
      throw new Error('OLLAMA model not specified');
    }

    let intialMessages = [...messages];

    const ollamaMessages: Message[] = intialMessages.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content ?? '',
    }))
    const ollamaTools = toOllamaTool(allTools);
    const executedToolCalls: ExecutedToolCall[] = [];
    let retryCount = 0;

    while (true) {
        const response = await ollama.chat({
            model,
            messages: ollamaMessages,
            tools: ollamaTools,
        });

        ollamaMessages.push(response.message);
        retryCount++;

        const toolCalls = response.message.tool_calls ?? [];
        if (toolCalls.length === 0 || retryCount > 10) {
            return {
              text: response.message.content,
              executedToolCalls: executedToolCalls,
            };
        }

        for (const call of toolCalls) {
          const tool = allTools.find(t => t.name === call.function.name);
          if (!tool) {
              ollamaMessages.push({
                  role: 'tool',
                  content: `Error: Unknown tool ${call.function.name}`,
                  tool_name: call.function.name,
              });
              continue;
          }

          const result = await tool.execute(call.function.arguments);
          ollamaMessages.push({
              role: 'tool',
              content: String(result),
              tool_name: call.function.name,
          });

          executedToolCalls.push({
              toolName: tool.name,
              args: call.function.arguments,
          });
        }
    }
}