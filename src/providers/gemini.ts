import { 
  FunctionCallingConfigMode, 
  type FunctionDeclaration,
  type FunctionCall,
  type FunctionResponse,
  type Content,
  type Part,
  GoogleGenAI, 
  Type, 
  Schema,
} from '@google/genai';
import { 
  type ChatMessage, 
  type ChatResult,
  type ExecutedToolCall,
} from './base';
import { allTools, type InternalTool } from '../tools/index';

// Helper function to retrieve the API key from environment variables, with error handling if the key is not defined
function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined in the environment variables.');
  }
  return apiKey;
}

// Convert internal tool definitions to the format expected by the Gemini API
function toGeminiFunctionDeclaration(internalTools: InternalTool[]): FunctionDeclaration[] {
  return internalTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: toGeminiSchema(tool.parameters),
  }));
}

// Convert internal tool parameters to the format expected by the Gemini API
function toGeminiSchema(schema: InternalTool['parameters']): Schema {
  const propertyTypeMap: Record<string, Type> = {
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
  };

  return {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [
        name,
        {
          type: propertyTypeMap[value.type] ?? Type.STRING,
          description: value.description,
          nullable: value.nullable ?? false,
        },
      ])
    ),
    required: Object.entries(schema.properties)
      .filter(([, value]) => value.required)
      .map(([name]) => name),
  };
}

// Convert internal chat messages to the format expected by the Gemini API
function toGeminiHistory(messages: ChatMessage[]): {
  systemInstruction?: Content;
  contents: Content[];
} {
  const systemMessages: ChatMessage[] = [];
  let systemInstruction: Content = {};
  const contents: Content[] = [];

  if (messages.length === 0) {
    return { contents: [{role: "user", parts: [{ text: 'Hello!' }]}] };
  }

  for (const message of messages) {
    if (message.role === 'system' && message.content) {
      systemMessages.push(message);
      continue;
    } 
    
    if (message.role === 'user' || message.role === 'model') {
      contents.push({
        role: message.role,
        parts: [{ text: message.content ?? '' }],
      });
      continue;
    } 

    if (message.role === 'tool') {
      const parts: Part[] = [];

      if (message.toolCallId){
        parts.push({ 
          functionResponse: {
            id: message.toolCallId,
            name: 'tool',
            response: {
              output: message.content,
            }
          }
        });
      } else if (message.content) {
        parts.push({ text: message.content });
      }

      if (parts.length > 0) {
        contents.push({
          role: 'user',
          parts,
        });
      }
    }
  }
  
  const systemMessagesContent = systemMessages.map(message => message.content?.trim()).filter(Boolean).join('\n\n');

  if (systemMessagesContent) {
    systemInstruction = {
      role: 'user',
      parts: [{ text: systemMessagesContent }],
    };
  }
  return { 
    systemInstruction, 
    contents 
  };
}

// Helper function to execute tool calls and return the responses
async function executeFunctionCalls(
  functionCalls: FunctionCall[], 
  tools: InternalTool[], 
  seenToolCallKeys: Set<string>,
): Promise<{
  toolResponses: FunctionResponse[],
  executedToolCalls: ExecutedToolCall[],
  hadNewToolCall: boolean,
  seenToolCallKeys: Set<string>,
}> {
  const executedToolCalls: ExecutedToolCall[] = [];
  const seenToolCallKeysCopy = new Set(seenToolCallKeys);
  let hadNewToolCall = false;

  const toolResponses = await Promise.all (
    functionCalls.map(async (functionCall) => {
      const tool = tools.find(t => t.name === functionCall.name);

      const toolCallKey = `${functionCall.name}:${JSON.stringify(functionCall.args)}`;

      if (!seenToolCallKeysCopy.has(toolCallKey)) {
        seenToolCallKeysCopy.add(toolCallKey);
        hadNewToolCall = true;
      }

      if (!tool) {
        const response: FunctionResponse = {
          id: functionCall.id ?? '',
          name: functionCall.name ?? '',
          response: {
            error: `Unknown tool: ${functionCall.name}`,
          },
        };

        executedToolCalls.push({
          toolName: functionCall.name ?? '',
          args: functionCall.args ?? {},
          succeeded: false,
          error: `Unknown tool: ${functionCall.name}`,
        });

        return response;
      }

      try {
        const result = await tool.execute(functionCall.args);
        const response: FunctionResponse = {
          id: functionCall.id ?? '',
          name: functionCall.name ?? '',
          response: {
            output: String(result),
          },
        };

        executedToolCalls.push({
          toolName: functionCall.name ?? '',
          args: functionCall.args ?? {},
          succeeded: true,
        });

        return response;

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const response: FunctionResponse = {
          id: functionCall.id ?? '',
          name: functionCall.name ?? '',
          response: {
            error: `Error executing tool ${functionCall.name}: ${message}`,
          },
        };

        executedToolCalls.push({
          toolName: functionCall.name ?? '',
          args: functionCall.args ?? {},
          succeeded: false,
          error: message,
        });

        return response;
      }
    }),
  );

  return { 
    toolResponses: toolResponses,
    executedToolCalls: executedToolCalls,
    hadNewToolCall: hadNewToolCall,
    seenToolCallKeys: seenToolCallKeysCopy,
  };
}

// Initialize the Gemini API client with the provided API key and function calling configuration
export async function chat(
  messages: ChatMessage[],
  config?: { model?: string }
): Promise<ChatResult> {
  const model = config?.model ?? process.env.GEMINI_MODEL;
  if (!model) {
    throw new Error('Gemini model not specified');
  }

  const { systemInstruction, contents } = toGeminiHistory(messages);
  const functionDeclarations = toGeminiFunctionDeclaration(allTools);
  const executedToolCalls: ExecutedToolCall[] = [];
  const gemini = new GoogleGenAI({apiKey: getApiKey()});

  let seenToolCallKeys = new Set<string>();
  let toolRoundCount = 0;

  while (true) {
    const response = await gemini.models.generateContent({
      model: model,
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello!' }] }],
      config: {
        systemInstruction: systemInstruction ?? '',
        tools: [{functionDeclarations}],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          }
        }
      },
    });

    const functionCalls = response.functionCalls ?? [];

    if (functionCalls.length === 0) {
      return {
        text: response.text ?? '',
        executedToolCalls,
        stopReason: 'no_tool_calls',
      };
    }

    if (toolRoundCount >= 10) {
      return {
        text: response.text ?? '',
        executedToolCalls,
        stopReason: 'tool_round_limit_reached',
      };
    }

    contents.push({
      role: 'model',
      parts: functionCalls.map((call) => ({ functionCall: call })),
    });

    const functionCallResult = await executeFunctionCalls(
      functionCalls,
      allTools,
      seenToolCallKeys,
    );

    const {
      toolResponses,
      executedToolCalls: roundExecutedToolCalls,
      hadNewToolCall,
      seenToolCallKeys: updatedSeenToolCallKeys,
    } = functionCallResult;

    seenToolCallKeys = updatedSeenToolCallKeys;

    contents.push({
      role: 'user',
      parts: toolResponses.map((response) => 
        ({ functionResponse: response })),
    });

    executedToolCalls.push(...roundExecutedToolCalls);

    if (!hadNewToolCall) {
      return {
        text: response.text ?? '',
        executedToolCalls,
        stopReason: 'repeated_tool_calls',
      };
    }

    toolRoundCount++;
  }
}
