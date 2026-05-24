import OpenAI from 'openai';
import {
  type ChatCompletion,
  type ChatCompletionAssistantMessageParam,
  type ChatCompletionMessageFunctionToolCall,
  type ChatCompletionMessageParam,
  type ChatCompletionMessageToolCall,
  type ChatCompletionTool,
  type ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';

import {
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type ExecutedToolCall,
} from './types';
import {
  allTools,
  getToolsForMode,
  type InternalTool,
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

function getApiKey(): string {
  return getRequiredRuntimeEnvVar('OPENROUTER_API_KEY');
}

function getDefaultHeaders(): Record<string, string> | undefined {
  const defaultHeaders: Record<string, string> = {};
  const httpReferer = getRuntimeEnvVar('OPENROUTER_HTTP_REFERER');
  const appTitle = getRuntimeEnvVar('OPENROUTER_APP_TITLE');

  if (httpReferer) {
    defaultHeaders['HTTP-Referer'] = httpReferer;
  }

  if (appTitle) {
    defaultHeaders['X-OpenRouter-Title'] = appTitle;
  }

  return Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined;
}

function toOpenRouterSchema(schema: InternalTool['parameters']) {
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
    }),
  );

  return {
    type: 'object',
    properties,
    required: Object.entries(schema.properties)
      .filter(([, value]) => value.required)
      .map(([name]) => name),
    additionalProperties: schema.additionalProperties ?? false,
  };
}

function toOpenRouterTools(internalTools: InternalTool[]): ChatCompletionTool[] {
  return internalTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toOpenRouterSchema(tool.parameters),
    },
  }));
}

function toOpenRouterHistory(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  if (messages.length === 0) {
    return [{ role: 'user', content: 'Hello!' }];
  }

  const completionMessages: ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    if ((message.role === 'system' || message.role === 'user') && message.content) {
      completionMessages.push({
        role: message.role,
        content: message.content,
      });
      continue;
    }

    if (message.role === 'model') {
      completionMessages.push({
        role: 'assistant',
        content: message.content ?? '',
      });
      continue;
    }

    if (message.role === 'tool' && message.toolCallId) {
      completionMessages.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content ?? '',
      });
    }
  }

  return completionMessages;
}

function safeCanonicalizeArgs(argumentsJson: string): string {
  try {
    return canonicalizeArgs(argumentsJson);
  } catch {
    return argumentsJson;
  }
}

function collectCurrentRoundFunctionCalls(toolCalls: ChatCompletionMessageToolCall[]): ToolCallFingerprint[] {
  return toolCalls
    .filter(isFunctionToolCall)
    .map((toolCall) => ({
      toolName: toolCall.function.name,
      argsKey: safeCanonicalizeArgs(toolCall.function.arguments),
    }));
}

function isFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall,
): toolCall is ChatCompletionMessageFunctionToolCall {
  return toolCall.type === 'function';
}

function toAssistantMessage(
  completion: ChatCompletion,
): ChatCompletionAssistantMessageParam {
  const assistantMessage = completion.choices[0]?.message;
  if (!assistantMessage) {
    throw new Error('OpenRouter returned no assistant message.');
  }

  return {
    role: 'assistant',
    content: assistantMessage.content ?? null,
    ...(assistantMessage.tool_calls ? { tool_calls: assistantMessage.tool_calls } : {}),
  };
}

function getAssistantText(assistantMessage: ChatCompletionAssistantMessageParam): string {
  return typeof assistantMessage.content === 'string'
    ? assistantMessage.content.trim()
    : '';
}

let openRouterClient: OpenAI | undefined;

function getOpenRouterClient(): OpenAI {
  openRouterClient ??= new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: getApiKey(),
    defaultHeaders: getDefaultHeaders(),
    maxRetries: 3,
  });

  return openRouterClient;
}

export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<ChatResult> {
  const model = options?.model ?? getRuntimeEnvVar('OPENROUTER_MODEL');
  if (!model) {
    throw new Error('OpenRouter model not specified');
  }

  const selectedTools = options?.tools ?? (options?.mode ? getToolsForMode(options.mode) : allTools);
  const openRouterTools = toOpenRouterTools(selectedTools);
  const completionMessages = toOpenRouterHistory(messages);
  const executedToolCalls: ExecutedToolCall[] = [];
  const openrouter = getOpenRouterClient();

  let toolRoundCount = 0;
  let previousRoundCalls: ToolCallFingerprint[] = [];

  while (true) {
    const completion = await openrouter.chat.completions.create({
      model,
      messages: completionMessages,
      tools: openRouterTools,
      tool_choice: 'auto',
    });

    const assistantMessage = toAssistantMessage(completion);
    const toolCalls = (assistantMessage.tool_calls ?? []).filter(isFunctionToolCall);
    const currentRoundCalls = collectCurrentRoundFunctionCalls(toolCalls);

    if (areSameStallSensitiveCalls(previousRoundCalls, currentRoundCalls)) {
      return {
        text: getAssistantText(assistantMessage),
        executedToolCalls,
        stopReason: 'repeated_tool_calls',
      };
    }

    previousRoundCalls = currentRoundCalls;
    completionMessages.push(assistantMessage);

    if (toolCalls.length === 0) {
      return {
        text: getAssistantText(assistantMessage),
        executedToolCalls,
        stopReason: 'no_tool_calls',
      };
    }

    if (toolRoundCount >= 10) {
      return {
        text: getAssistantText(assistantMessage),
        executedToolCalls,
        stopReason: 'tool_round_limit_reached',
      };
    }

    for (const toolCall of toolCalls) {
      const normalizedArgs = parseAndNormalizeToolArgsJson(toolCall.function.arguments);

      if (!normalizedArgs.ok) {
        const invalidArgsFailure = buildInvalidToolArgsFailure(
          toolCall.function.name,
          normalizedArgs.error,
        );

        completionMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: invalidArgsFailure.output,
        } satisfies ChatCompletionToolMessageParam);
        executedToolCalls.push(invalidArgsFailure.executedToolCall);
        continue;
      }

      const args = normalizedArgs.args;
      const executionResult = await executeToolCall(
        toolCall.function.name,
        args,
        options?.mode ? { mode: options.mode } : undefined,
      );

      completionMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: executionResult.output,
      } satisfies ChatCompletionToolMessageParam);
      executedToolCalls.push(executionResult.executedToolCall);
    }
    toolRoundCount++;
  }
}
