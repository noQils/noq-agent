import ollama, {
    type Message,
} from 'ollama';
import { allTools, type Tool } from '../tools';
import { type ChatMessage } from './base';

// Helper function to convert internal tool definitions to the format expected by Ollama
function toOllamaTools(internalTools: Tool[]) {
  return internalTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

// Main chat function to interact with the Ollama model, handling messages and tool calls
export async function chat(
  messages: ChatMessage[],
  config?: { model?: string }
): Promise<string> {

    const model = config?.model ?? process.env.OLLAMA_DEFAULT_MODEL;
    if (!model) {
      throw new Error('OLLAMA model not specified');
    }

    let currentMessages = [...messages];
    if (!currentMessages.some(m => m.role === 'system')) {
        currentMessages.unshift({
            role: 'system',
            content: `You are an AI coding assistant.

Your job is to help the user accurately and efficiently.

Tool-use rules:
- You may use tools only when they are necessary to answer the user's request.
- If the user asks about files, code, folders, or project contents, use the available tools when needed.
- If the user is just chatting, greeting you, or asking for general explanation, respond directly without using any tools.
- Never invent tools that are not explicitly available to you.
- If a task requires a tool you do not have, say so clearly instead of pretending.
- If the user asks for the contents of files in a folder, first determine which files exist before trying to read them.
- Do not guess file paths or filenames unless the user provided them or you discovered them through available tools.

Response rules:
- Be concise, clear, and helpful.
- If you use a tool, use the tool result faithfully.
- If no tool is needed, answer normally.
- Do not output fake JSON or pretend tool calls in plain text.`
        });
    }


    const ollamaMessages: Message[] = currentMessages.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content ?? '',
    }))
    const ollamaTools = toOllamaTools(allTools);

    while (true) {
        const response = await ollama.chat({
            model,
            messages: ollamaMessages,
            tools: ollamaTools,
        });

        ollamaMessages.push(response.message);

        const toolCalls = response.message.tool_calls ?? [];
        if (toolCalls.length === 0 && response.message.content) {
            try {
                const parsed = JSON.parse(response.message.content);
                if (parsed.name && parsed.arguments) {
                    toolCalls.push({
                        function: {
                            name: parsed.name,
                            arguments: parsed.arguments
                        }
                    });
                    response.message.content = '';
                }
            } catch {
                // Not JSON, ignore
            }
        }

        if (toolCalls.length) {
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
            }
            continue;
        }

        return response.message.content;
    }
}