import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type FormattedDefinitionLocation } from '../analysis/definitionTypes';
import { type FormattedDiagnostic } from '../analysis/diagnosticsTypes';
import { type RenameFileEdit } from '../analysis/renameTypes';
import { resolveProjectPath } from '../fileUtils';
import {
  ensureFileExists,
  findSymbolColumn,
  getSourceLine,
  normalizeFilePath,
  runCommand,
  toWorkspaceRelativePath,
} from './shared';

export const goExtensions = ['.go'];

function parseGoDiagnostics(stderr: string): FormattedDiagnostic[] {
  const diagnostics: FormattedDiagnostic[] = [];
  const lines = stderr.replaceAll('\r\n', '\n').split('\n');

  for (const line of lines) {
    const match = line.match(/^(.*?):(\d+):(?:(\d+):)?\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, filePath, lineNumber, columnNumber, message] = match;
    if (!filePath || !lineNumber || !message) {
      continue;
    }

    diagnostics.push({
      filePath: toWorkspaceRelativePath(normalizeFilePath(path.isAbsolute(filePath) ? filePath : resolveProjectPath(filePath))),
      line: Number(lineNumber),
      ...(columnNumber ? { column: Number(columnNumber) } : {}),
      code: 'go-build',
      category: 'error',
      message: message.trim(),
      language: 'go',
    });
  }

  return diagnostics;
}

function collectGoPackageDirectories(filePaths: string[]): string[] {
  return [...new Set(filePaths.map((filePath) => path.dirname(ensureFileExists(filePath))))];
}

export function getGoDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  if (filePaths.length === 0) {
    return [];
  }

  const goModPath = resolveProjectPath('go.mod');
  const diagnostics: FormattedDiagnostic[] = [];

  if (fs.existsSync(goModPath)) {
    const result = runCommand('go', ['build', './...'], {
      missingMessage: 'Cannot collect go diagnostics because "go" is not installed.',
    });
    return result.status === 0 ? [] : parseGoDiagnostics(result.stderr);
  }

  for (const packageDirectory of collectGoPackageDirectories(filePaths)) {
    const result = runCommand('go', ['build', '.'], {
      cwd: packageDirectory,
      missingMessage: 'Cannot collect go diagnostics because "go" is not installed.',
    });
    if (result.status !== 0) {
      diagnostics.push(...parseGoDiagnostics(result.stderr));
    }
  }

  return diagnostics;
}

export function getGoDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence: number;
}): FormattedDefinitionLocation[] {
  const absoluteFilePath = ensureFileExists(options.filePath);
  const lineText = getSourceLine(absoluteFilePath, options.line);
  const columnIndex = findSymbolColumn(lineText, options.symbol, options.occurrence);
  const target = `${absoluteFilePath}:${options.line}:${columnIndex + 1}`;
  const result = runCommand('gopls', ['definition', '-json', target], {
    missingMessage: 'Cannot resolve go definitions because "gopls" is not installed.',
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(message.length > 0 ? message : 'gopls exited with an error.');
  }

  const payload = JSON.parse(result.stdout) as {
    span?: {
      uri?: string;
      start?: {
        line?: number;
        column?: number;
      };
    };
  };

  const fileUri = payload.span?.uri;
  const startLine = payload.span?.start?.line;
  const startColumn = payload.span?.start?.column;
  if (!fileUri || !startLine || !startColumn) {
    return [];
  }

  const definitionFilePath = fileURLToPath(fileUri);
  return [{
    filePath: toWorkspaceRelativePath(normalizeFilePath(definitionFilePath)),
    line: startLine,
    column: startColumn,
    lineText: getSourceLine(definitionFilePath, startLine),
  }];
}

interface GoReferenceEntry {
  uri?: string;
  range?: {
    start?: {
      line?: number;
      character?: number;
    };
  };
  span?: {
    uri?: string;
    start?: {
      line?: number;
      column?: number;
    };
  };
}

export function getGoReferences(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence: number;
}): FormattedDefinitionLocation[] {
  const absoluteFilePath = ensureFileExists(options.filePath);
  const lineText = getSourceLine(absoluteFilePath, options.line);
  const columnIndex = findSymbolColumn(lineText, options.symbol, options.occurrence);
  const target = `${absoluteFilePath}:${options.line}:${columnIndex + 1}`;
  const result = runCommand('gopls', ['references', '-json', target], {
    missingMessage: 'Cannot resolve go references because "gopls" is not installed.',
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(message.length > 0 ? message : 'gopls exited with an error.');
  }

  const trimmedOutput = result.stdout.trim();
  if (trimmedOutput.length === 0) {
    return [];
  }

  const entries = JSON.parse(trimmedOutput) as GoReferenceEntry[];

  return entries.flatMap((entry) => {
    if (entry.span?.uri && entry.span.start?.line && entry.span.start?.column) {
      const referenceFilePath = fileURLToPath(entry.span.uri);
      return [{
        filePath: toWorkspaceRelativePath(normalizeFilePath(referenceFilePath)),
        line: entry.span.start.line,
        column: entry.span.start.column,
        lineText: getSourceLine(referenceFilePath, entry.span.start.line),
      }];
    }

    if (entry.uri && entry.range?.start?.line !== undefined && entry.range.start?.character !== undefined) {
      const referenceFilePath = fileURLToPath(entry.uri);
      const line = entry.range.start.line + 1;
      return [{
        filePath: toWorkspaceRelativePath(normalizeFilePath(referenceFilePath)),
        line,
        column: entry.range.start.character + 1,
        lineText: getSourceLine(referenceFilePath, line),
      }];
    }

    return [];
  });
}

export function planGoRename(): RenameFileEdit[] {
  throw new Error('rename_symbol is not supported for Go yet.');
}
