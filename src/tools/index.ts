import { globTool } from './glob';
import { grepTool } from './grep';
import { readFileTool } from './readFile';
import { editFileTool } from './editFile';
import { writeFileTool } from './writeFile';
import { listDirTool } from './listDir';
import { runCommandTool } from './runCommand';
import { PermissionScope } from '../permissions/types';


export const allTools: InternalTool[] = [
  readFileTool, 
  globTool,
  grepTool,
  editFileTool,
  writeFileTool,
  listDirTool,
  runCommandTool,
];

const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

export function getToolByName(name: string): InternalTool | undefined {
  return toolsByName.get(name);
}

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
    permission: {
    scope: PermissionScope;
    getTarget: (args: Record<string, unknown>) => string;
  };
  execute: (args: any) => Promise<string> | string;
}
