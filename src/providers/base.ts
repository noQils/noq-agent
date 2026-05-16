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
}

export interface ChatResult {
  text: string;
  executedToolCalls?: ExecutedToolCall[];
}


export interface Provider {
    // Method to handle chat interactions with the model, including tool calls
    chat(messages: ChatMessage[]): Promise<ChatResult>;
}
