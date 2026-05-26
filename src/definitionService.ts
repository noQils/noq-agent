import fs from 'node:fs';
import path from 'node:path';

import { type FormattedDefinitionLocation } from './definitionTypes';
import { type DiagnosticLanguage } from './diagnosticsTypes';
import { getProjectFilePaths, resolveProjectPath } from './fileUtils';
import { getGoDefinition, goExtensions } from './languages/go';
import { getJavaDefinition, javaExtensions } from './languages/java';
import { getPythonDefinition, pythonExtensions } from './languages/python';
import {
  ensureFileExists,
  normalizeFilePath,
  toWorkspaceRelativePath,
  validatePositiveInteger,
} from './languages/shared';
import { goToTypeScriptDefinition } from './languages/typescript';

const supportedExtensions = new Map<string, DiagnosticLanguage>([
  ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => [extension, 'typescript'] as const),
  ...pythonExtensions.map((extension) => [extension, 'python'] as const),
  ...javaExtensions.map((extension) => [extension, 'java'] as const),
  ...goExtensions.map((extension) => [extension, 'go'] as const),
]);

function inferLanguageFromFilePath(filePath: string): DiagnosticLanguage | null {
  return supportedExtensions.get(path.extname(filePath).toLowerCase()) ?? null;
}

function dedupeDefinitionLocations(definitions: FormattedDefinitionLocation[]): FormattedDefinitionLocation[] {
  const seen = new Set<string>();
  const deduped: FormattedDefinitionLocation[] = [];

  for (const definition of definitions) {
    const key = JSON.stringify([
      definition.filePath,
      definition.line,
      definition.column,
      definition.lineText,
    ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(definition);
  }

  return deduped;
}

export function goToDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence?: number;
}): FormattedDefinitionLocation[] {
  validatePositiveInteger(options.line, 'line');

  const occurrence = options.occurrence ?? 1;
  validatePositiveInteger(occurrence, 'occurrence');

  if (!options.symbol.trim()) {
    throw new Error('symbol must be a non-empty string.');
  }

  const language = inferLanguageFromFilePath(options.filePath);
  if (!language) {
    throw new Error(`Unsupported file type for definitions: ${options.filePath}`);
  }

  const definitions = (() => {
    switch (language) {
      case 'typescript':
        return goToTypeScriptDefinition({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'python':
        return getPythonDefinition({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'go':
        return getGoDefinition({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'java':
        return getJavaDefinition({
          filePath: options.filePath,
          symbol: options.symbol,
        });
    }
  })();

  return dedupeDefinitionLocations(definitions);
}
