import ollama, {
  type Message,
} from 'ollama';

import { 
  type ChatMessage, 
  type ChatOptions,
  type ChatResult,
  type ExecutedToolCall,
} from './types';
import { allTools, getToolsForMode, type InternalTool } from '../tools';
import {
  canonicalizeArgsValue,
  areSameStallSensitiveCalls,
  type ToolCallFingerprint,
} from './shared/toolFingerprint';
import { buildInvalidToolArgsFailure } from './shared/toolFailures';
import { normalizeToolArgs } from './shared/toolArgs';
import { runProviderRequest } from './shared/providerRuntime';
import { executeToolCall } from '../runtime/executeToolCall';
import { getRuntimeEnvVar } from '../runtimeEnv';
import { debugLog } from '../runtimeSettings';

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

type OllamaToolCall = NonNullable<Message['tool_calls']>[number];

function collectCurrentRoundToolCalls(toolCalls: OllamaToolCall[]): ToolCallFingerprint[] {
  return toolCalls.map(call => ({
    toolName: call.function.name,
    argsKey: canonicalizeArgsValue(call.function.arguments),
  }));
}

// Main chat function to interact with the Ollama model, handling messages and tool calls
export async function chat(
  messages: ChatMessage[],
  options?: ChatOptions,
): Promise<ChatResult> {
  const model = options?.model ?? getRuntimeEnvVar('OLLAMA_DEFAULT_MODEL');
  if (!model) {
    throw new Error('OLLAMA model not specified');
  }

  const ollamaMessages: Message[] = messages.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.content ?? '',
  }));
  const selectedTools = options?.tools ?? (options?.mode ? getToolsForMode(options.mode) : allTools);
  const ollamaTools = toOllamaTool(selectedTools);
  debugLog('Ollama chat start:', {
    model,
    mode: options?.mode,
    messageCount: messages.length,
    toolCount: ollamaTools.length,
  });

  const executedToolCalls: ExecutedToolCall[] = [];

  let toolRoundCount = 0;
  let previousRoundCalls: ToolCallFingerprint[] = [];

  while (true) {
    const response = await runProviderRequest('Ollama', 'chat', () => ollama.chat({
        model,
        messages: ollamaMessages,
        tools: ollamaTools,
    }));

    ollamaMessages.push(response.message);

    const toolCalls = response.message.tool_calls ?? [];
    const currentRoundCalls = collectCurrentRoundToolCalls(toolCalls);
    debugLog(`Ollama round ${toolRoundCount + 1}: ${JSON.stringify(currentRoundCalls)}`);

    if (areSameStallSensitiveCalls(previousRoundCalls, currentRoundCalls)) {
      debugLog('Ollama chat stopped: repeated tool calls.', {
        toolRoundCount,
        executedToolCallCount: executedToolCalls.length,
      });
      return {
        text: response.message.content,
        executedToolCalls,
        stopReason: 'repeated_tool_calls',
      };
    }

    previousRoundCalls = currentRoundCalls;

    if (toolCalls.length === 0) {
      debugLog('Ollama chat completed: no tool calls.', {
        toolRoundCount,
        executedToolCallCount: executedToolCalls.length,
        textLength: response.message.content.length,
      });
      return {
        text: response.message.content,
        executedToolCalls: executedToolCalls,
        stopReason: 'no_tool_calls',
      };
    }

    if (toolRoundCount >= 10) {
      debugLog('Ollama chat stopped: tool round limit reached.', {
        toolRoundCount,
        executedToolCallCount: executedToolCalls.length,
      });
      return {
        text: response.message.content,
        executedToolCalls: executedToolCalls,
        stopReason: 'tool_round_limit_reached',
      };
    }

    for (const call of toolCalls) {
      const normalizedArgs = normalizeToolArgs(call.function.arguments);
      debugLog('Ollama tool call', call.function.name, 'with args:', normalizedArgs.ok ? normalizedArgs.args : call.function.arguments);

      if (!normalizedArgs.ok) {
        const invalidArgsFailure = buildInvalidToolArgsFailure(
          call.function.name,
          normalizedArgs.error,
        );

        ollamaMessages.push({
          role: 'tool',
          content: `Error: ${invalidArgsFailure.output}`,
          tool_name: call.function.name,
        });

        executedToolCalls.push(invalidArgsFailure.executedToolCall);
        debugLog('Ollama tool call rejected: invalid arguments.', {
          toolName: call.function.name,
          error: normalizedArgs.error,
        });
        continue;
      }

      const executionResult = await executeToolCall(
        call.function.name,
        normalizedArgs.args,
        {
          ...(options?.mode ? { mode: options.mode } : {}),
          ...(options?.onMutation ? { onMutation: options.onMutation } : {}),
        },
      );

      ollamaMessages.push({
        role: 'tool',
        content: executionResult.executedToolCall.succeeded
          ? executionResult.output
          : `Error: ${executionResult.output}`,
        tool_name: call.function.name,
      });

      executedToolCalls.push(executionResult.executedToolCall);
      debugLog('Ollama tool call result:', {
        toolName: call.function.name,
        succeeded: executionResult.executedToolCall.succeeded,
        failureKind: executionResult.executedToolCall.failureKind,
        outputLength: executionResult.output.length,
      });
    }

    toolRoundCount++;
  }
}
