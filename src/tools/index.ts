import { globTool } from './glob';
import { grepTool } from './grep';
import { readFileTool } from './readFile';
import { editFileTool } from './editFile';
import { writeFileTool } from './writeFile';
import { listDirTool } from './listDir';
import { runCommandTool } from './runCommand';
import { todoReadTool } from './todoRead';
import { todoWriteTool } from './todoWrite';
import { PermissionScope } from '../permissions/types';
import { type AgentMode } from '../agentMode';


export const allTools: InternalTool[] = [
  todoReadTool,
  todoWriteTool,
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

export function getToolsForMode(mode: AgentMode): InternalTool[] {
  return allTools.filter((tool) => tool.allowedModes.includes(mode));
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
  allowedModes: AgentMode[];
  permission: {
    scope: PermissionScope;
    getTarget: (args: Record<string, unknown>) => string;
  };
  execute: (args: any) => Promise<string> | string;
}
