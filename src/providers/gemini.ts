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
import { allTools, getToolByName, type InternalTool } from '../tools/index';
import {
  canonicalizeArgsValue,
  areSameStallSensitiveCalls,
  type ToolCallFingerprint,
} from './toolFingerprint';

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

const geminiFunctionDeclarations = toGeminiFunctionDeclaration(allTools);
let geminiClient: GoogleGenAI | undefined;

function getGeminiClient(): GoogleGenAI {
  geminiClient ??= new GoogleGenAI({ apiKey: getApiKey() });
  return geminiClient;
}

// Convert internal chat messages to the format expected by the Gemini API
function toGeminiHistory(messages: ChatMessage[]): {
  systemInstruction?: Content;
  contents: Content[];
} {
  const systemMessages: ChatMessage[] = [];
  let systemInstruction: Content | undefined;
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

  if (systemInstruction) {
    return { systemInstruction, contents };
  }

  return { contents };
}

function collectCurrentRoundFunctionCalls(functionCalls: FunctionCall[]): ToolCallFingerprint[] {
  return functionCalls.map(call => ({
    toolName: call.name ?? '',
    argsKey: canonicalizeArgsValue(call.args ?? {}),
  }));
}

// Helper function to execute tool calls and return the responses
async function executeFunctionCalls(
  functionCalls: FunctionCall[],
): Promise<{
  toolResponses: FunctionResponse[],
  executedToolCalls: ExecutedToolCall[],
}> {
  const executedToolCalls: ExecutedToolCall[] = [];
  const toolResponses: FunctionResponse[] = [];

  for (const functionCall of functionCalls) {
    const toolName = functionCall.name ?? '';
    const args = functionCall.args ?? {};
    const tool = getToolByName(toolName);

    if (!tool) {
      const response: FunctionResponse = {
        id: functionCall.id ?? '',
        name: toolName,
        response: {
          error: `Unknown tool: ${functionCall.name}`,
        },
      };

      toolResponses.push(response);
      executedToolCalls.push({
        toolName,
        args,
        succeeded: false,
        error: `Unknown tool: ${functionCall.name}`,
      });

      continue;
    }

    try {
      const result = await tool.execute(args);
      const response: FunctionResponse = {
        id: functionCall.id ?? '',
        name: toolName,
        response: {
          output: String(result),
        },
      };

      toolResponses.push(response);
      executedToolCalls.push({
        toolName,
        args,
        succeeded: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response: FunctionResponse = {
        id: functionCall.id ?? '',
        name: toolName,
        response: {
          error: `Error executing tool ${functionCall.name}: ${message}`,
        },
      };

      toolResponses.push(response);
      executedToolCalls.push({
        toolName,
        args,
        succeeded: false,
        error: message,
      });
    }
  }

  return { 
    toolResponses: toolResponses,
    executedToolCalls: executedToolCalls,
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
  const functionDeclarations = geminiFunctionDeclarations;
  const executedToolCalls: ExecutedToolCall[] = [];
  const gemini = getGeminiClient();

  let toolRoundCount = 0;
  let previousRoundCalls: ToolCallFingerprint[] = [];

  while (true) {
    const response = await gemini.models.generateContent({
      model: model,
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello!' }] }],
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        tools: [{functionDeclarations}],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          }
        }
      },
    });

    const functionCalls = response.functionCalls ?? [];
    const currentRoundCalls = collectCurrentRoundFunctionCalls(functionCalls);

    if (areSameStallSensitiveCalls(previousRoundCalls, currentRoundCalls)) {
      return {
        text: response.text ?? '',
        executedToolCalls,
        stopReason: 'repeated_tool_calls',
      };
    }

    previousRoundCalls = currentRoundCalls;

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
    );

    const {
      toolResponses,
      executedToolCalls: roundExecutedToolCalls,
    } = functionCallResult;

    contents.push({
      role: 'user',
      parts: toolResponses.map((response) => 
        ({ functionResponse: response })),
    });

    executedToolCalls.push(...roundExecutedToolCalls);

    toolRoundCount++;
  }
}
