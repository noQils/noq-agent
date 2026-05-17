import OpenAI from 'openai';
import { 
  type ResponseInputItem,
  type Tool,
} from 'openai/resources/responses/responses';
import { 
  type ChatMessage, 
  type ChatResult, 
  type ExecutedToolCall 
} from './base';
import { allTools, type InternalTool } from '../tools';

// Helper function to retrieve the API key from environment variables
function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not defined in the environment variables.');
  }
  return apiKey;
}

// Helper function to convert internal tool definitions to the format expected by OpenAI
function toOpenAIFunctionTool(internalTools: InternalTool[]): Tool[]{
  return internalTools.map(tool => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toOpenAISchema(tool.parameters),
    strict: true,
  }));
}

function toOpenAISchema(schema: InternalTool['parameters']) {
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, value]) => {
      const jsonType =
        value.nullable || !value.required
          ? [value.type, 'null']
          : value.type;

      return [
        name,
        {
          type: jsonType,
          description: value.description,
        },
      ];
    })
  );

  return {
    type: 'object',
    properties,
    required: Object.keys(schema.properties),
    additionalProperties: schema.additionalProperties ?? false,
  };
}

function toOpenAIHistory(messages: ChatMessage[]):{
  instructions?: string;
  input: ResponseInputItem[];
} {
  const systemMessages: ChatMessage[] = [];
  const input: ResponseInputItem[] = [];

  if (messages.length === 0) {
    return { input: [{role: "user", content: [{ text: "Hello!", type: 'input_text' }]}] };
  }

  for (const message of messages) {
    if (message.role === 'system' && message.content) {
      systemMessages.push(message);
      continue;
    } 

    if (message.role === 'user') {
      input.push({
        role: message.role,
        content: [{ text: message.content ?? '', type: 'input_text' }],
      });
      continue;
    }

    if (message.role === 'model') {
      input.push({
        role: 'assistant',
        content: message.content ?? '',
      });
      continue;
    }

    if (message.role === 'tool' && message.toolCallId) {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content ?? '',
      });
    }
  }

  const systemMessagesContent = systemMessages.map(message => message.content?.trim()).filter(Boolean).join('\n\n');

  return {
    instructions: systemMessagesContent,
    input
  }
}

// Main chat function
export async function chat(
    messages: ChatMessage[], 
    config?: { model?: string }
): Promise<ChatResult> {
    const model = config?.model ?? process.env.OPENAI_MODEL;
    if (!model) {
      throw new Error('OpenAI model not specified');
    }

    let initialMessages = [...messages];
    if (!initialMessages.some(m => m.role === 'system')) {
        initialMessages.unshift({
            role: 'system',
            content: `You are an AI coding assistant working inside a local code project.

Your job is to help the user accurately and efficiently using the available tools when needed.

Rules for tool use:
- Use tools only when they help answer the request correctly.
- If the user asks about code, files, folders, or project contents, use the tools instead of guessing.
- Never invent files, paths, tool results, or tool calls.
- Never pretend a tool was used if it was not actually used.
- If a task requires a tool you do not have, say so clearly.
- Before editing a file, inspect the relevant file content.
- After editing a file, read the file again to verify the change.
- If the edit leaves behind broken references, inconsistent code, or obvious follow-up changes that are required to satisfy the user’s request, continue editing and verifying until the requested change is complete and the affected code appears internally consistent.
- Do not claim success until you have verified the final result.
- If an edit fails or the result does not match the intent, explain that clearly.
- Prefer the smallest correct change that satisfies the user’s request.

Rules for responses:
- Be concise, clear, and direct.
- Base your answer on the actual tool results.
- Do not claim success unless you verified it.
- If no tools are needed, answer normally.`
        });
    }

    const openai = new OpenAI({apiKey: getApiKey()});
    const {instructions, input} = toOpenAIHistory(initialMessages);
    const functionDeclarations = toOpenAIFunctionTool(allTools);
    const executedToolCalls: ExecutedToolCall[] = [];

    let response = await openai.responses.create({
          model: model,
          instructions: instructions ?? null,
          input: input,
          tools: functionDeclarations,
      });
      let retryCount  = 0;

    while (true) {


      const toolOutputs: ResponseInputItem[] = [];

      for (const item of response.output) {
        if (item.type !== 'function_call') continue;

        const tool = allTools.find(t => t.name === item.name);
        if (!tool) {
          toolOutputs.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output: `Error: Unknown tool ${item.name}`,
          });
          continue;
        }

        try {
          const args = JSON.parse(item.arguments);
          const result = await tool.execute(args);

          toolOutputs.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output: String(result),
          });

          executedToolCalls.push({
            toolName: item.name,
            args: args,
          });
        } catch (error) {
          toolOutputs.push({
            type: 'function_call_output',
            call_id: item.call_id,
            output: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (toolOutputs.length === 0 || retryCount > 10) {
        return {
          text: response.output_text ?? '',
          executedToolCalls: executedToolCalls,
        };
      }

      response = await openai.responses.create({
        model: model,
        previous_response_id: response.id,
        input: toolOutputs,
        tools: functionDeclarations,
      });
      retryCount++;
    }
}
