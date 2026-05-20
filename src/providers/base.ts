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

export interface ExecutedToolCall {
  toolName: string;
  args: Record<string, unknown>;
  succeeded: boolean;
  error?: string;
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
