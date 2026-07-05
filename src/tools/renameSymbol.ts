import { applyRenamePlan, planRenameSymbol } from '../analysis/renameService';
import { InternalTool } from './index';

function planRename(args: Record<string, unknown>) {
  return planRenameSymbol({
    filePath: typeof args.filePath === 'string' ? args.filePath : '',
    line: typeof args.line === 'number' ? args.line : 0,
    symbol: typeof args.symbol === 'string' ? args.symbol : '',
    newName: typeof args.newName === 'string' ? args.newName : '',
    ...(typeof args.occurrence === 'number' ? { occurrence: args.occurrence } : {}),
  });
}

export const renameSymbolTool: InternalTool = {
  name: 'rename_symbol',
  description: 'Rename a symbol and rewrite every reference to it across the affected files. TypeScript and JavaScript use the TypeScript language service; Python uses Jedi. Not supported for Go or Java yet.',
  allowedModes: ['build'],
  permission: {
    scope: 'edit',
    getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '',
    getPathTargets: (args) => planRename(args).map((edit) => edit.relativeFilePath),
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
        description: 'The exact current symbol text to rename.',
        required: true,
      },
      newName: {
        type: 'string',
        description: 'The new name for the symbol.',
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
    newName: string;
    occurrence?: number | null;
  }) => {
    const edits = planRenameSymbol({
      filePath: args.filePath,
      line: args.line,
      symbol: args.symbol,
      newName: args.newName,
      ...(typeof args.occurrence === 'number' ? { occurrence: args.occurrence } : {}),
    });

    const changedFiles = applyRenamePlan(edits);

    return `Renamed "${args.symbol}" to "${args.newName}" in:\n${changedFiles.map((file) => `- ${file}`).join('\n')}`;
  },
};
