import { getDiagnostics } from '../diagnosticsService';
import { type DiagnosticLanguage } from '../diagnosticsTypes';
import { InternalTool } from './index';

const defaultMaxDiagnostics = 100;

export const getDiagnosticsTool: InternalTool = {
  name: 'get_diagnostics',
  description: 'Get diagnostics for supported languages. TypeScript and JavaScript use project-aware compiler settings; Python, Java, and Go use their native compilers. Pass filePath to scope the results to one file.',
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
        description: 'Optional file to check. If omitted, diagnostics are collected across supported project files.',
        required: false,
        nullable: true,
      },
      language: {
        type: 'string',
        description: 'Optional language override. Supported values: "typescript", "python", "java", "go".',
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
    language?: DiagnosticLanguage | null;
    includeSuggestions?: boolean | null;
    maxDiagnostics?: number | null;
  }) => {
    const diagnostics = getDiagnostics({
      ...(typeof args.filePath === 'string' ? { filePath: args.filePath } : {}),
      ...(typeof args.language === 'string' ? { language: args.language } : {}),
      ...(typeof args.includeSuggestions === 'boolean'
        ? { includeSuggestions: args.includeSuggestions }
        : {}),
      maxDiagnostics: args.maxDiagnostics ?? defaultMaxDiagnostics,
    });

    return JSON.stringify(diagnostics, null, 2);
  },
};
