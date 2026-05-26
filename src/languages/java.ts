import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type FormattedDefinitionLocation } from '../definitionTypes';
import { type FormattedDiagnostic } from '../diagnosticsTypes';
import { getProjectFilePaths, resolveProjectPath } from '../fileUtils';
import {
  ensureFileExists,
  escapeRegex,
  normalizeFilePath,
  runCommand,
  splitFileLines,
  toWorkspaceRelativePath,
} from './shared';

export const javaExtensions = ['.java'];

function parseJavaDiagnostics(stderr: string): FormattedDiagnostic[] {
  const diagnostics: FormattedDiagnostic[] = [];
  const lines = stderr.replaceAll('\r\n', '\n').split('\n');
  let currentDiagnostic: FormattedDiagnostic | null = null;

  for (const line of lines) {
    const match = line.match(/^(.*?):(\d+):\s*(warning|error):\s*(.+)$/);
    if (match) {
      const [, filePath, lineNumber, category, message] = match;
      if (!filePath || !lineNumber || !category || !message) {
        currentDiagnostic = null;
        continue;
      }

      const diagnostic: FormattedDiagnostic = {
        filePath: toWorkspaceRelativePath(normalizeFilePath(path.isAbsolute(filePath) ? filePath : resolveProjectPath(filePath))),
        line: Number(lineNumber),
        code: `javac-${category}`,
        category,
        message: message.trim(),
        language: 'java',
      };
      currentDiagnostic = diagnostic;
      diagnostics.push(diagnostic);
      continue;
    }

    if (!currentDiagnostic) {
      continue;
    }

    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine === '^' || trimmedLine.endsWith('error') || trimmedLine.endsWith('warning')) {
      continue;
    }

    currentDiagnostic.message = `${currentDiagnostic.message}\n${trimmedLine}`;
  }

  return diagnostics;
}

export function getJavaDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  if (filePaths.length === 0) {
    return [];
  }

  const absoluteFilePaths = filePaths.map(ensureFileExists);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-javac-'));

  try {
    const result = runCommand('javac', ['-Xlint:none', '-d', outputDirectory, ...absoluteFilePaths], {
      missingMessage: 'Cannot collect java diagnostics because "javac" is not installed.',
    });
    return result.status === 0 ? [] : parseJavaDiagnostics(result.stderr);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function getJavaDefinitionPatterns(symbol: string): RegExp[] {
  const escapedSymbol = escapeRegex(symbol);
  const patterns = [
    new RegExp(`^\\s*(?:public|protected|private|abstract|final|static|sealed|non-sealed\\s+)*(?:class|interface|enum|record|@interface)\\s+${escapedSymbol}\\b`),
    new RegExp(`^\\s*(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp\\s+)*(?:<[^>]+>\\s*)?(?:[\\w$.[\\]<>?,]+\\s+)+${escapedSymbol}\\s*\\([^;{}]*\\)\\s*(?:throws\\s+[\\w$.,\\s]+)?\\s*(?:\\{|;)`),
    new RegExp(`^\\s*(?:public|protected|private|static|final|transient|volatile\\s+)*(?:[\\w$.[\\]<>?,]+\\s+)+${escapedSymbol}\\b\\s*(?:=|;|,)`),
  ];

  if (/^[A-Z]/.test(symbol)) {
    patterns.push(
      new RegExp(`^\\s*(?:public\\s+|protected\\s+|private\\s+)?${escapedSymbol}\\s*\\([^;{}]*\\)\\s*(?:throws\\s+[\\w$.,\\s]+)?\\s*(?:\\{|;)`),
    );
  }

  return patterns;
}

export function getJavaDefinition(options: {
  filePath: string;
  symbol: string;
}): FormattedDefinitionLocation[] {
  ensureFileExists(options.filePath);

  const javaFiles = getProjectFilePaths().filter((filePath) => path.extname(filePath).toLowerCase() === '.java');
  const patterns = getJavaDefinitionPatterns(options.symbol);
  const definitions: FormattedDefinitionLocation[] = [];

  for (const filePath of javaFiles) {
    const absoluteFilePath = normalizeFilePath(resolveProjectPath(filePath));
    const lines = splitFileLines(fs.readFileSync(absoluteFilePath, 'utf-8'));

    for (const [index, lineText] of lines.entries()) {
      const firstMatch = patterns
        .map((pattern) => pattern.exec(lineText))
        .find((match) => match !== null);

      if (!firstMatch || firstMatch.index === undefined) {
        continue;
      }

      const symbolColumn = lineText.indexOf(options.symbol, firstMatch.index);
      if (symbolColumn === -1) {
        continue;
      }

      definitions.push({
        filePath: toWorkspaceRelativePath(absoluteFilePath),
        line: index + 1,
        column: symbolColumn + 1,
        lineText,
      });
    }
  }

  return definitions;
}
