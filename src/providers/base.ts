import { type PermissionScope } from '../permissions/types';

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'model' | 'tool';
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export type ToolFailureKind =
  | 'unknown_tool'
  | 'invalid_tool_arguments'
  | 'permission_denied'
  | 'tool_error';

export interface ExecutedToolCall {
  toolName: string;
  args: Record<string, unknown>;
  succeeded: boolean;
  error?: string;
  failureKind?: ToolFailureKind;
  permissionScope?: PermissionScope;
  target?: string;
  permissionDeniedBy?: 'policy' | 'user';
}

export type StopReason =
  | 'no_tool_calls'
  | 'repeated_tool_calls'
  | 'tool_round_limit_reached';

export interface ChatResult {
  text: string;
  executedToolCalls?: ExecutedToolCall[];
  stopReason?: StopReason;
}

export interface Provider {
    // Method to handle chat interactions with the model, including tool calls
    chat(messages: ChatMessage[]): Promise<ChatResult>;
}
