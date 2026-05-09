import { readFileFunction } from "./readFile";

// Aggregate all tools into a single exportable array for easy access and management
export const allTools: Tool[] = [readFileFunction];

// Function to execute a tool based on the function call from the model
export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (args: any) => Promise<string> | string;
}

