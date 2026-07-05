import { findReferences } from '../analysis/referencesService';
import { InternalTool } from './index';

export const findReferencesTool: InternalTool = {
  name: 'find_references',
  description: 'Find all usages of a symbol in a supported source file. TypeScript and JavaScript use the TypeScript language service, Python uses Jedi, Go uses gopls, and Java uses a best-effort regex search.',
  allowedModes: ['plan', 'build'],
  permission: {
    scope: 'read',
    getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '',
  },
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The file containing the symbol reference.',
        required: true,
      },
      line: {
        type: 'integer',
        description: 'The 1-based line number containing the symbol reference.',
        required: true,
      },
      symbol: {
        type: 'string',
        description: 'The exact symbol text to resolve on that line.',
        required: true,
      },
      occurrence: {
        type: 'integer',
        description: 'Optional 1-based occurrence index if the same symbol text appears multiple times on the line.',
        required: false,
        nullable: true,
      },
    },
  },
  execute: (args: {
    filePath: string;
    line: number;
    symbol: string;
    occurrence?: number | null;
  }) => {
    const references = findReferences({
      filePath: args.filePath,
      line: args.line,
      symbol: args.symbol,
      ...(typeof args.occurrence === 'number' ? { occurrence: args.occurrence } : {}),
    });

    return JSON.stringify(references, null, 2);
  },
};
