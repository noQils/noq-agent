import ollama, {
  type Message,
} from 'ollama';
import { 
  type ChatMessage, 
  type ChatResult,
  type ExecutedToolCall,
} from './base';
import { allTools, getToolByName, type InternalTool } from '../tools';

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

const ollamaTools = toOllamaTool(allTools);

// Main chat function to interact with the Ollama model, handling messages and tool calls
export async function chat(
  messages: ChatMessage[],
  config?: { model?: string }
): Promise<ChatResult> {
  const model = config?.model ?? process.env.OLLAMA_DEFAULT_MODEL;
  if (!model) {
    throw new Error('OLLAMA model not specified');
  }

  const ollamaMessages: Message[] = messages.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.content ?? '',
  }));

  const executedToolCalls: ExecutedToolCall[] = [];

  let toolRoundCount = 0;

  while (true) {
    const response = await ollama.chat({
        model,
        messages: ollamaMessages,
        tools: ollamaTools,
    });

    ollamaMessages.push(response.message);

    const toolCalls = response.message.tool_calls ?? [];
    console.log(`Round ${toolRoundCount + 1} tool calls:`, toolCalls.map(call => call.function.name));

    if (toolCalls.length === 0) {
      console.log("No tool calls found.");
      return {
        text: response.message.content,
        executedToolCalls: executedToolCalls,
        stopReason: 'no_tool_calls',
      };
    }

    if (toolRoundCount >= 10) {
      return {
        text: response.message.content,
        executedToolCalls: executedToolCalls,
        stopReason: 'tool_round_limit_reached',
      };
    }

    for (const call of toolCalls) {
      const tool = getToolByName(call.function.name);
      if (!tool) {
          ollamaMessages.push({
              role: 'tool',
              content: `Error: Unknown tool ${call.function.name}`,
              tool_name: call.function.name,
          });

          executedToolCalls.push({
            toolName: call.function.name,
            args: call.function.arguments,
            succeeded: false,
            error: `Error: Unknown tool ${call.function.name}`,
          });
          
          continue;
      }

      console.log('Calling:', call.function.name, 'with arguments:', call.function.arguments);

      try {
        const result = await tool.execute(call.function.arguments);

        ollamaMessages.push({
            role: 'tool',
            content: String(result),
            tool_name: call.function.name,
        });

        executedToolCalls.push({
            toolName: tool.name,
            args: call.function.arguments,
            succeeded: true,
        });
        
        } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        ollamaMessages.push({
            role: 'tool',
            content: `Error: ${message}`,
            tool_name: call.function.name,
        });

        executedToolCalls.push({
          toolName: tool.name,
          args: call.function.arguments,
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    toolRoundCount++;
  }
}
