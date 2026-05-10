export interface ChatMessage {
  role: 'system' | 'user' | 'model' | 'tool';
  content?: string;
  toolCalls?: any[];
  toolCallId?: string;
}

export interface Provider {
    // Method to generate text based on a prompt
    generateText(prompt: string): Promise<string>;
    
    // Method to handle chat interactions with the model, including tool calls
    chat(messages: ChatMessage[]): Promise<{
        text?: string;
        toolCalls?: any[];
    }>;
}
