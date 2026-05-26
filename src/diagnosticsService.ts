import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { type DiagnosticLanguage, type FormattedDiagnostic } from './diagnosticsTypes';
import { getProjectFilePaths, resolveProjectPath } from './fileUtils';
import { getTypeScriptDiagnostics } from './typescriptService';

const defaultMaxDiagnostics = 100;
const maxAllowedDiagnostics = 500;

const supportedExtensions = new Map<string, DiagnosticLanguage>([
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

function validatePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

function validateMaxDiagnostics(value: number): number {
  validatePositiveInteger(value, 'maxDiagnostics');
  return Math.min(value, maxAllowedDiagnostics);
}

function inferLanguageFromFilePath(filePath: string): DiagnosticLanguage | null {
  return supportedExtensions.get(path.extname(filePath).toLowerCase()) ?? null;
}

function dedupeDiagnostics(diagnostics: FormattedDiagnostic[]): FormattedDiagnostic[] {
  const seen = new Set<string>();
  const deduped: FormattedDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.language,
      diagnostic.filePath ?? '',
      diagnostic.line ?? 0,
      diagnostic.column ?? 0,
      diagnostic.code,
      diagnostic.category,
      diagnostic.message,
    ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(diagnostic);
  }

  return deduped;
}

function ensureCommandAvailable(command: string, language: DiagnosticLanguage): void {
  const result = spawnSync(command, ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    throw new Error(`Cannot collect ${language} diagnostics because "${command}" is not installed.`);
  }
}

function ensureFileExists(filePath: string): string {
  const absoluteFilePath = normalizeFilePath(resolveProjectPath(filePath));
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return absoluteFilePath;
}

function parsePythonDiagnostics(stderr: string): FormattedDiagnostic[] {
  const fileMatch = stderr.match(/File "(.+?)", line (\d+)/);
  const lines = stderr.replaceAll('\r\n', '\n').split('\n').filter((line) => line.trim().length > 0);
  const message = lines.at(-1);

  if (!fileMatch || !message) {
    return [];
  }

  const [, matchedFilePath, matchedLine] = fileMatch;
  if (!matchedFilePath || !matchedLine) {
    return [];
  }

  return [{
    filePath: toWorkspaceRelativePath(normalizeFilePath(matchedFilePath)),
    line: Number(matchedLine),
    code: 'python-compile',
    category: 'error',
    message,
    language: 'python',
  }];
}

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

function runCommand(
  command: string,
  args: string[],
  language: DiagnosticLanguage,
  cwd = process.cwd(),
): SpawnSyncReturns<string> {
  ensureCommandAvailable(command, language);

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function getPythonDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  const diagnostics: FormattedDiagnostic[] = [];

  for (const filePath of filePaths) {
    const absoluteFilePath = ensureFileExists(filePath);
    const result = runCommand('python', ['-m', 'py_compile', absoluteFilePath], 'python');

    if (result.status === 0) {
      continue;
    }

    diagnostics.push(...parsePythonDiagnostics(result.stderr));
  }

  return diagnostics;
}

function getJavaDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  if (filePaths.length === 0) {
    return [];
  }

  const absoluteFilePaths = filePaths.map(ensureFileExists);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-javac-'));

  try {
    const result = runCommand('javac', ['-Xlint:none', '-d', outputDirectory, ...absoluteFilePaths], 'java');
    return result.status === 0 ? [] : parseJavaDiagnostics(result.stderr);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function collectGoPackageDirectories(filePaths: string[]): string[] {
  return [...new Set(filePaths.map((filePath) => path.dirname(ensureFileExists(filePath))))];
}

function getGoDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  if (filePaths.length === 0) {
    return [];
  }

  const goModPath = resolveProjectPath('go.mod');
  const diagnostics: FormattedDiagnostic[] = [];

  if (fs.existsSync(goModPath)) {
    const result = runCommand('go', ['build', './...'], 'go');
    return result.status === 0 ? [] : parseGoDiagnostics(result.stderr);
  }

  for (const packageDirectory of collectGoPackageDirectories(filePaths)) {
    const result = runCommand('go', ['build', '.'], 'go', packageDirectory);
    if (result.status !== 0) {
      diagnostics.push(...parseGoDiagnostics(result.stderr));
    }
  }

  return diagnostics;
}

function getProjectFilesForLanguage(language: DiagnosticLanguage): string[] {
  return getProjectFilePaths()
    .filter((filePath) => inferLanguageFromFilePath(filePath) === language);
}

function getDiagnosticsForLanguage(language: DiagnosticLanguage, options: {
  filePath?: string;
  includeSuggestions: boolean;
}): FormattedDiagnostic[] {
  const targetFile = options.filePath;

  switch (language) {
    case 'typescript':
      return getTypeScriptDiagnostics({
        ...(targetFile ? { filePath: targetFile } : {}),
        includeSuggestions: options.includeSuggestions,
        maxDiagnostics: maxAllowedDiagnostics,
      });
    case 'python':
      return getPythonDiagnostics(targetFile ? [targetFile] : getProjectFilesForLanguage('python'));
    case 'java':
      return getJavaDiagnostics(targetFile ? [targetFile] : getProjectFilesForLanguage('java'));
    case 'go':
      return getGoDiagnostics(targetFile ? [targetFile] : getProjectFilesForLanguage('go'));
  }
}

function getLanguagesToCheck(filePath?: string, language?: DiagnosticLanguage): DiagnosticLanguage[] {
  if (language) {
    return [language];
  }

  if (filePath) {
    const inferredLanguage = inferLanguageFromFilePath(filePath);
    if (!inferredLanguage) {
      throw new Error(`Unsupported file type for diagnostics: ${filePath}`);
    }

    return [inferredLanguage];
  }

  return ['typescript', 'python', 'java', 'go'];
}

export function getDiagnostics(options?: {
  filePath?: string;
  language?: DiagnosticLanguage;
  includeSuggestions?: boolean;
  maxDiagnostics?: number;
}): FormattedDiagnostic[] {
  const maxDiagnostics = validateMaxDiagnostics(options?.maxDiagnostics ?? defaultMaxDiagnostics);
  const filePath = options?.filePath;
  const includeSuggestions = options?.includeSuggestions ?? false;

  if (filePath) {
    ensureFileExists(filePath);
  }

  const diagnosticOptions = {
    ...(filePath ? { filePath } : {}),
    includeSuggestions,
  };

  const diagnostics = getLanguagesToCheck(filePath, options?.language)
    .flatMap((language) => getDiagnosticsForLanguage(language, diagnosticOptions));

  return dedupeDiagnostics(diagnostics).slice(0, maxDiagnostics);
}
