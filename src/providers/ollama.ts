import ollama from 'ollama';
import { allTools, Tool } from '../tools';

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
  messages: Array<{ role: string; content?: string; tool_calls?: any[]; tool_call_id?: string }>,
  config?: { model?: string }
): Promise<string> {

    // Determine the Ollama model to use, either from the provided config or from environment variables
    const model = config?.model ?? process.env.OLLAMA_DEFAULT_MODEL;
    if (!model) {
      throw new Error('OLLAMA model not specified');
    }

    // Convert internal tools to Ollama tools
    const ollamaTools = toOllamaTools(allTools);
    let currentMessages = [...messages];

    // Main chat loop to handle interactions with the Ollama model, including tool calls
    while (true) {
        // Send the current conversation to the Ollama model and get a response
        const response = await ollama.chat({
            model,
            messages: currentMessages.map(msg => ({
                ...msg,
                content: msg.content ?? ''
            })),
            tools: ollamaTools,
            think: true,
        });

        currentMessages.push(response.message);

        // Check for tool calls in the response and execute them if present
        const toolCalls = response.message.tool_calls ?? []

        // If there are no tool calls, return the text response from the model
        if (toolCalls.length === 0) {
            return response.message.content || '';
        }

        // If there are tool calls, execute each tool and add the results back to the conversation
        if (toolCalls.length) {
            for (const call of toolCalls) {
                const tool = allTools.find(t => t.name === call.function.name);
                if (!tool) {
                    currentMessages.push({
                        role: 'tool',
                        content: `Error: Unknown tool ${call.function.name}`,
                    });
                    continue;
                }

                // Execute the tool with the provided arguments and add the result to the conversation
                const result = await tool.execute(call.function.arguments);
                currentMessages.push({
                    role: 'tool',
                    content: String(result),
                });
            }
        }
    }
}