import { getTypeScriptDiagnostics } from '../typescriptService';
import { InternalTool } from './index';

const defaultMaxDiagnostics = 100;

export const getDiagnosticsTool: InternalTool = {
  name: 'get_diagnostics',
  description: 'Get TypeScript or JavaScript diagnostics using the project compiler settings. Pass filePath to scope the results to one file.',
  allowedModes: ['plan', 'build'],
  permission: {
    scope: 'read',
    getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '.',
  },
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Optional file to check. If omitted, diagnostics are collected for the current TypeScript project.',
        required: false,
        nullable: true,
      },
      includeSuggestions: {
        type: 'boolean',
        description: 'Set to true to include suggestion diagnostics in addition to syntax and semantic diagnostics.',
        required: false,
        nullable: true,
      },
      maxDiagnostics: {
        type: 'integer',
        description: 'Maximum number of diagnostics to return. Defaults to 100 and is capped at 500.',
        required: false,
        nullable: true,
      },
    },
  },
  execute: (args: {
    filePath?: string | null;
    includeSuggestions?: boolean | null;
    maxDiagnostics?: number | null;
  }) => {
    const diagnostics = getTypeScriptDiagnostics({
      ...(typeof args.filePath === 'string' ? { filePath: args.filePath } : {}),
      ...(typeof args.includeSuggestions === 'boolean'
        ? { includeSuggestions: args.includeSuggestions }
        : {}),
      maxDiagnostics: args.maxDiagnostics ?? defaultMaxDiagnostics,
    });

    return JSON.stringify(diagnostics, null, 2);
  },
};
