import { type ExecutedToolCall } from './base';

export interface ToolFailureResult {
  output: string;
  executedToolCall: ExecutedToolCall;
}

export function buildInvalidToolArgsFailure(
  toolName: string,
  error: string,
): ToolFailureResult {
  return {
    output: error,
    executedToolCall: {
      toolName,
      args: {},
      succeeded: false,
      error,
      failureKind: 'invalid_tool_arguments',
    },
  };
}
