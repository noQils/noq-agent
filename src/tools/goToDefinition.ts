import { goToTypeScriptDefinition } from '../typescriptService';
import { InternalTool } from './index';

export const goToDefinitionTool: InternalTool = {
  name: 'go_to_definition',
  description: 'Resolve the definition location for a symbol in a TypeScript or JavaScript file. Provide a 1-based line number and the symbol text from that line.',
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
    const definitions = goToTypeScriptDefinition({
      filePath: args.filePath,
      line: args.line,
      symbol: args.symbol,
      ...(typeof args.occurrence === 'number' ? { occurrence: args.occurrence } : {}),
    });

    return JSON.stringify(definitions, null, 2);
  },
};
