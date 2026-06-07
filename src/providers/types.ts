import { type AgentMode } from '../agentMode';
import { type InternalTool } from '../tools';
import { type PermissionScope } from '../permissions/types';
import { type SessionFileChange } from '../session/sessionChangeTracker';

export const providerNames = ['ollama', 'gemini', 'openai', 'openrouter'] as const;
export type ProviderName = typeof providerNames[number];

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
  | 'mode_denied'
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
  blockedByMode?: AgentMode;
  permissionDeniedBy?: 'policy' | 'user';
}

export interface ToolMutationEvent {
  toolName: string;
  args: Record<string, unknown>;
  executedToolCall: ExecutedToolCall;
  fileChanges: SessionFileChange[];
  diff: string;
}

export type ToolMutationCallback = (
  event: ToolMutationEvent,
) => void | Promise<void>;

export type StopReason =
  | 'no_tool_calls'
  | 'repeated_tool_calls'
  | 'tool_round_limit_reached';

export interface ChatResult {
  text: string;
  executedToolCalls?: ExecutedToolCall[];
  stopReason?: StopReason;
}

export interface ChatOptions {
  model?: string;
  mode?: AgentMode;
  tools?: InternalTool[];
  onMutation?: ToolMutationCallback;
}

export interface Provider {
    // Method to handle chat interactions with the model, including tool calls
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}
