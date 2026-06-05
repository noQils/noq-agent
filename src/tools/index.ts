import { globTool } from './glob';
import { grepTool } from './grep';
import { readFileTool } from './readFile';
import { editFileTool } from './editFile';
import { writeFileTool } from './writeFile';
import { listDirTool } from './listDir';
import { runCommandTool } from './runCommand';
import { todoReadTool } from './todoRead';
import { todoWriteTool } from './todoWrite';
import { applyPatchTool } from './applyPatch';
import { getDiagnosticsTool } from './getDiagnostics';
import { goToDefinitionTool } from './goToDefinition';
import { PermissionScope } from '../permissions/types';
import { type AgentMode } from '../agentMode';


export const allTools: InternalTool[] = [
  todoReadTool,
  todoWriteTool,
  readFileTool, 
  globTool,
  grepTool,
  getDiagnosticsTool,
  goToDefinitionTool,
  applyPatchTool,
  editFileTool,
  writeFileTool,
  listDirTool,
  runCommandTool,
];

const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

export function getToolByName(name: string): InternalTool | undefined {
  return toolsByName.get(name);
}

const buildModeToolNames = new Set(allTools.map((tool) => tool.name));

const planModeToolNames = new Set([
  readFileTool.name,
  globTool.name,
  grepTool.name,
  getDiagnosticsTool.name,
  goToDefinitionTool.name,
  listDirTool.name,
]);

export function getToolsForMode(mode: AgentMode): InternalTool[] {
  const allowedToolNames = mode === 'plan'
    ? planModeToolNames
    : buildModeToolNames;

  return allTools.filter((tool) => allowedToolNames.has(tool.name));
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
    getPathTargets?: (args: Record<string, unknown>) => string[];
  };
  execute: (args: any) => Promise<string> | string;
}
