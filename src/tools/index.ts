import { readFileTool } from "./readFile";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { editFileTool } from "./editFile";

export const allTools: InternalTool[] = [readFileTool, globTool, grepTool, editFileTool];

type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean';

export interface ToolParameter {
  type: PrimitiveType;
  description: string;
  required?: boolean;
  nullable?: boolean;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameter>;
  additionalProperties?: boolean;
}

export interface InternalTool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: any) => Promise<string> | string;
}

