import OpenAI from 'openai';
import { 
  type ResponseInputItem,
  type Tool,
  type Response,
} from 'openai/resources/responses/responses';

import { 
  type ChatMessage, 
  type ChatOptions,
  type ChatResult, 
  type ExecutedToolCall 
} from './types';
import { 
  allTools, 
  getToolsForMode,
  type InternalTool
} from '../tools';
import {
  canonicalizeArgs,
  areSameStallSensitiveCalls,
  type ToolCallFingerprint,
} from './shared/toolFingerprint';
import { buildInvalidToolArgsFailure } from './shared/toolFailures';
import { parseAndNormalizeToolArgsJson } from './shared/toolArgs';
import { executeToolCall } from '../runtime/executeToolCall';
import { getRequiredRuntimeEnvVar, getRuntimeEnvVar } from '../runtimeEnv';

// Helper function to retrieve the API key from environment variables
function getApiKey(): string {
  return getRequiredRuntimeEnvVar('OPENAI_API_KEY');
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
let openAIClient: OpenAI | undefined;

function getOpenAIClient(): OpenAI {
  openAIClient ??= new OpenAI({ apiKey: getApiKey(), maxRetries: 3 });
  return openAIClient;
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

type OpenAIFunctionCall = Extract<Response['output'][number], { type: 'function_call' }>;

function getFunctionCalls(response: Response): OpenAIFunctionCall[] {
  return response.output.filter((item): item is OpenAIFunctionCall => item.type === 'function_call');
}

function safeCanonicalizeArgs(argumentsJson: string): string {
  try {
    return canonicalizeArgs(argumentsJson);
  } catch {
    return argumentsJson;
  }
}

function collectCurrentRoundFunctionCalls(functionCalls: OpenAIFunctionCall[]): ToolCallFingerprint[] {
  return functionCalls
    .map(item => ({
      toolName: item.name,
      argsKey: safeCanonicalizeArgs(item.arguments),
  }));
}

// Main chat function
export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<ChatResult> {
  const model = options?.model ?? getRuntimeEnvVar('OPENAI_MODEL');
  if (!model) throw new Error('OpenAI model not specified');

  const {instructions, input} = toOpenAIHistory(messages);
  const selectedTools = options?.tools ?? (options?.mode ? getToolsForMode(options.mode) : allTools);
  const functionDeclarations = toOpenAIFunctionTool(selectedTools);
  const executedToolCalls: ExecutedToolCall[] = [];
  const openai = getOpenAIClient();

  let response = await openai.responses.create({
    model: model,
    instructions: instructions ?? null,
    input: input,
    tools: functionDeclarations,
  });
  
  let toolRoundCount = 0;
  let previousRoundCalls: ToolCallFingerprint[] = [];

  while (true) {
    const toolOutputs: ResponseInputItem[] = [];
    const functionCalls = getFunctionCalls(response);
    const currentRoundCalls = collectCurrentRoundFunctionCalls(functionCalls);

    if (areSameStallSensitiveCalls(previousRoundCalls, currentRoundCalls)) {
      return {
        text: response.output_text?.trim(),
        executedToolCalls,
        stopReason: 'repeated_tool_calls',
      };
    }

    previousRoundCalls = currentRoundCalls;
    console.log(`Round ${toolRoundCount + 1}: ${JSON.stringify(currentRoundCalls)}`);

    for (const item of functionCalls) {
      const normalizedArgs = parseAndNormalizeToolArgsJson(item.arguments);
      if (!normalizedArgs.ok) {
        const invalidArgsFailure = buildInvalidToolArgsFailure(
          item.name,
          normalizedArgs.error,
        );

        toolOutputs.push({
          type: 'function_call_output',
          call_id: item.call_id,
          output: invalidArgsFailure.output,
        });

        executedToolCalls.push(invalidArgsFailure.executedToolCall);

        continue;
      }

      const args = normalizedArgs.args;
      
      console.log('Tool call', item.name, 'with args:', args);

      const executionResult = await executeToolCall(
        item.name,
        args,
        {
          ...(options?.mode ? { mode: options.mode } : {}),
          ...(options?.onMutation ? { onMutation: options.onMutation } : {}),
        },
      );

      toolOutputs.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: executionResult.output,
      });

      executedToolCalls.push(executionResult.executedToolCall);
    }

    if (toolOutputs.length === 0) {
      return {
        text: response.output_text?.trim(),
        executedToolCalls: executedToolCalls,
        stopReason: 'no_tool_calls',
      };
    }

    if (toolRoundCount >= 10) {
      return {
        text: response.output_text?.trim(),
        executedToolCalls: executedToolCalls,
        stopReason: 'tool_round_limit_reached',
      };
    }

    response = await openai.responses.create({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      tools: functionDeclarations,
    });

    toolRoundCount++;
    console.log('\n');
  }
}
