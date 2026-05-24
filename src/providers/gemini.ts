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
  type ChatOptions,
  type ChatResult,
  type ExecutedToolCall,
} from './types';
import { allTools, getToolsForMode, type InternalTool } from '../tools/index';
import {
  canonicalizeArgsValue,
  areSameStallSensitiveCalls,
  type ToolCallFingerprint,
} from './shared/toolFingerprint';
import { buildInvalidToolArgsFailure } from './shared/toolFailures';
import { normalizeToolArgs } from './shared/toolArgs';
import { executeToolCall } from '../runtime/executeToolCall';
import { getRequiredRuntimeEnvVar, getRuntimeEnvVar } from '../runtimeEnv';

// Helper function to retrieve the API key from environment variables, with error handling if the key is not defined
function getApiKey(): string {
  return getRequiredRuntimeEnvVar('GEMINI_API_KEY');
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
  mode?: ChatOptions['mode'],
): Promise<{
  toolResponses: FunctionResponse[],
  executedToolCalls: ExecutedToolCall[],
}> {
  const executedToolCalls: ExecutedToolCall[] = [];
  const toolResponses: FunctionResponse[] = [];

  for (const functionCall of functionCalls) {
    const toolName = functionCall.name ?? '';
    const normalizedArgs = normalizeToolArgs(functionCall.args);

    if (!normalizedArgs.ok) {
      const invalidArgsFailure = buildInvalidToolArgsFailure(
        toolName,
        normalizedArgs.error,
      );

      const response: FunctionResponse = {
        id: functionCall.id ?? '',
        name: toolName,
        response: {
          error: invalidArgsFailure.output,
        },
      };

      toolResponses.push(response);
      executedToolCalls.push(invalidArgsFailure.executedToolCall);
      continue;
    }

    const args = normalizedArgs.args;

    const executionResult = await executeToolCall(
      toolName,
      args,
      mode ? { mode } : undefined,
    );
    const response: FunctionResponse = executionResult.executedToolCall.succeeded
      ? {
          id: functionCall.id ?? '',
          name: toolName,
          response: {
            output: executionResult.output,
          },
        }
      : {
          id: functionCall.id ?? '',
          name: toolName,
          response: {
            error: executionResult.output,
          },
        };

    toolResponses.push(response);
    executedToolCalls.push(executionResult.executedToolCall);
  }

  return { 
    toolResponses: toolResponses,
    executedToolCalls: executedToolCalls,
  };
}

// Initialize the Gemini API client with the provided API key and function calling configuration
export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<ChatResult> {
  const model = options?.model ?? getRuntimeEnvVar('GEMINI_MODEL');
  if (!model) {
    throw new Error('Gemini model not specified');
  }

  const { systemInstruction, contents } = toGeminiHistory(messages);
  const selectedTools = options?.tools ?? (options?.mode ? getToolsForMode(options.mode) : allTools);
  const functionDeclarations = toGeminiFunctionDeclaration(selectedTools);
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
      options?.mode,
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
