import fs from 'node:fs';
import path from 'node:path';

import { type DiagnosticLanguage } from './diagnosticsTypes';
import { type RenameFileEdit } from './renameTypes';
import { goExtensions, planGoRename } from '../languages/go';
import { javaExtensions } from '../languages/java';
import { planPythonRename, pythonExtensions } from '../languages/python';
import { validatePositiveInteger } from '../languages/shared';
import { planTypeScriptRename } from '../languages/typescript';

const supportedExtensions = new Map<string, DiagnosticLanguage>([
  ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => [extension, 'typescript'] as const),
  ...pythonExtensions.map((extension) => [extension, 'python'] as const),
  ...javaExtensions.map((extension) => [extension, 'java'] as const),
  ...goExtensions.map((extension) => [extension, 'go'] as const),
]);

function inferLanguageFromFilePath(filePath: string): DiagnosticLanguage | null {
  return supportedExtensions.get(path.extname(filePath).toLowerCase()) ?? null;
}

export function planRenameSymbol(options: {
  filePath: string;
  line: number;
  symbol: string;
  newName: string;
  occurrence?: number;
}): RenameFileEdit[] {
  validatePositiveInteger(options.line, 'line');

  const occurrence = options.occurrence ?? 1;
  validatePositiveInteger(occurrence, 'occurrence');

  if (!options.symbol.trim()) {
    throw new Error('symbol must be a non-empty string.');
  }

  if (!options.newName.trim()) {
    throw new Error('newName must be a non-empty string.');
  }

  const language = inferLanguageFromFilePath(options.filePath);
  if (!language) {
    throw new Error(`Unsupported file type for rename: ${options.filePath}`);
  }

  switch (language) {
    case 'typescript':
      return planTypeScriptRename({
        filePath: options.filePath,
        line: options.line,
        symbol: options.symbol,
        newName: options.newName,
        occurrence,
      });
    case 'python':
      return planPythonRename({
        filePath: options.filePath,
        line: options.line,
        symbol: options.symbol,
        newName: options.newName,
        occurrence,
      });
    case 'go':
      return planGoRename();
    case 'java':
      throw new Error('rename_symbol is not supported for Java (no semantic engine available).');
  }
}

export function applyRenamePlan(edits: RenameFileEdit[]): string[] {
  const changedFiles: string[] = [];

  for (const edit of edits) {
    fs.writeFileSync(edit.absoluteFilePath, edit.newContent);
    changedFiles.push(edit.relativeFilePath);
  }

  return changedFiles;
}
