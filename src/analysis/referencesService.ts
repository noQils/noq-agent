import path from 'node:path';

import { type FormattedDefinitionLocation } from './definitionTypes';
import { type DiagnosticLanguage } from './diagnosticsTypes';
import { getGoReferences, goExtensions } from '../languages/go';
import { getJavaReferences, javaExtensions } from '../languages/java';
import { getPythonReferences, pythonExtensions } from '../languages/python';
import { validatePositiveInteger } from '../languages/shared';
import { findTypeScriptReferences } from '../languages/typescript';

const supportedExtensions = new Map<string, DiagnosticLanguage>([
  ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => [extension, 'typescript'] as const),
  ...pythonExtensions.map((extension) => [extension, 'python'] as const),
  ...javaExtensions.map((extension) => [extension, 'java'] as const),
  ...goExtensions.map((extension) => [extension, 'go'] as const),
]);

function inferLanguageFromFilePath(filePath: string): DiagnosticLanguage | null {
  return supportedExtensions.get(path.extname(filePath).toLowerCase()) ?? null;
}

function dedupeReferenceLocations(references: FormattedDefinitionLocation[]): FormattedDefinitionLocation[] {
  const seen = new Set<string>();
  const deduped: FormattedDefinitionLocation[] = [];

  for (const reference of references) {
    const key = JSON.stringify([
      reference.filePath,
      reference.line,
      reference.column,
      reference.lineText,
    ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(reference);
  }

  return deduped;
}

export function findReferences(options: {
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
    throw new Error(`Unsupported file type for references: ${options.filePath}`);
  }

  const references = (() => {
    switch (language) {
      case 'typescript':
        return findTypeScriptReferences({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'python':
        return getPythonReferences({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'go':
        return getGoReferences({
          filePath: options.filePath,
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
      case 'java':
        return getJavaReferences({
          filePath: options.filePath,
          symbol: options.symbol,
        });
    }
  })();

  return dedupeReferenceLocations(references);
}
