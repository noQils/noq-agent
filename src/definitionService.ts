import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { type FormattedDefinitionLocation } from './definitionTypes';
import { getProjectFilePaths, resolveProjectPath } from './fileUtils';
import { goToTypeScriptDefinition } from './typescriptService';

type DefinitionLanguage = 'typescript' | 'python' | 'java' | 'go';

const supportedExtensions = new Map<string, DefinitionLanguage>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'typescript'],
  ['.jsx', 'typescript'],
  ['.mts', 'typescript'],
  ['.cts', 'typescript'],
  ['.mjs', 'typescript'],
  ['.cjs', 'typescript'],
  ['.py', 'python'],
  ['.java', 'java'],
  ['.go', 'go'],
]);

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}

function toWorkspaceRelativePath(filePath: string): string {
  const workspaceRoot = path.resolve(process.cwd());
  const relativePath = path.relative(workspaceRoot, filePath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return relativePath.replaceAll('\\', '/') || '.';
  }

  return filePath.replaceAll('\\', '/');
}

function splitFileLines(content: string): string[] {
  return content.replaceAll('\r\n', '\n').split('\n');
}

function validatePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

function getSourceLine(filePath: string, lineNumber: number): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = splitFileLines(content);
  return lines[lineNumber - 1] ?? '';
}

function findSymbolColumn(lineText: string, symbol: string, occurrence: number): number {
  let startIndex = 0;
  let matchCount = 0;

  while (true) {
    const matchIndex = lineText.indexOf(symbol, startIndex);
    if (matchIndex === -1) {
      break;
    }

    matchCount += 1;
    if (matchCount === occurrence) {
      return matchIndex;
    }

    startIndex = matchIndex + Math.max(symbol.length, 1);
  }

  throw new Error(`Could not find occurrence ${occurrence} of symbol "${symbol}" on the requested line.`);
}

function ensureFileExists(filePath: string): string {
  const absoluteFilePath = normalizeFilePath(resolveProjectPath(filePath));
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return absoluteFilePath;
}

function inferLanguageFromFilePath(filePath: string): DefinitionLanguage | null {
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

function ensureCommandAvailable(command: string): void {
  const result = spawnSync(command, ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    shell: false,
  });

  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    throw new Error(`Cannot resolve definitions because "${command}" is not installed.`);
  }
}

function runCommand(command: string, args: string[], cwd = process.cwd()): string {
  ensureCommandAvailable(command);

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(message.length > 0 ? message : `${command} exited with status ${result.status}.`);
  }

  return result.stdout;
}

function getPythonDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence: number;
}): FormattedDefinitionLocation[] {
  const absoluteFilePath = ensureFileExists(options.filePath);
  const lineText = getSourceLine(absoluteFilePath, options.line);
  const columnIndex = findSymbolColumn(lineText, options.symbol, options.occurrence);

  const script = [
    'import json',
    'import pathlib',
    'import sys',
    'import jedi',
    'file_path = pathlib.Path(sys.argv[1]).resolve()',
    'line = int(sys.argv[2])',
    'column = int(sys.argv[3])',
    "source = file_path.read_text(encoding='utf-8')",
    'script = jedi.Script(source, path=str(file_path))',
    'results = []',
    'for name in script.goto(line, column):',
    '    module_path = name.module_path',
    '    if module_path is None:',
    '        continue',
    '    module_path = str(pathlib.Path(module_path).resolve())',
    '    results.append({',
    "        'filePath': module_path,",
    "        'line': name.line,",
    "        'column': name.column + 1,",
    '    })',
    'print(json.dumps(results))',
  ].join('\n');

  const stdout = runCommand('python', ['-c', script, absoluteFilePath, String(options.line), String(columnIndex)]);
  const rawDefinitions = JSON.parse(stdout) as Array<{
    filePath: string;
    line: number;
    column: number;
  }>;

  return rawDefinitions.map((definition) => ({
    filePath: toWorkspaceRelativePath(normalizeFilePath(definition.filePath)),
    line: definition.line,
    column: definition.column,
    lineText: getSourceLine(definition.filePath, definition.line),
  }));
}

function getGoDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence: number;
}): FormattedDefinitionLocation[] {
  const absoluteFilePath = ensureFileExists(options.filePath);
  const lineText = getSourceLine(absoluteFilePath, options.line);
  const columnIndex = findSymbolColumn(lineText, options.symbol, options.occurrence);
  const target = `${absoluteFilePath}:${options.line}:${columnIndex + 1}`;
  const stdout = runCommand('gopls', ['definition', '-json', target]);
  const payload = JSON.parse(stdout) as {
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function getJavaDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence: number;
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
          line: options.line,
          symbol: options.symbol,
          occurrence,
        });
    }
  })();

  return dedupeDefinitionLocations(definitions);
}
