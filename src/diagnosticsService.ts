import fs from 'node:fs';
import path from 'node:path';

import { type DiagnosticLanguage, type FormattedDiagnostic } from './diagnosticsTypes';
import { getProjectFilePaths, resolveProjectPath } from './fileUtils';
import { getGoDiagnostics, goExtensions } from './languages/go';
import { getJavaDiagnostics, javaExtensions } from './languages/java';
import { getPythonDiagnostics, pythonExtensions } from './languages/python';
import { getTypeScriptDiagnostics } from './languages/typescript';
import { normalizeFilePath } from './languages/shared';

const defaultMaxDiagnostics = 100;
const maxAllowedDiagnostics = 500;

const supportedExtensions = new Map<string, DiagnosticLanguage>([
  ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map((extension) => [extension, 'typescript'] as const),
  ...pythonExtensions.map((extension) => [extension, 'python'] as const),
  ...javaExtensions.map((extension) => [extension, 'java'] as const),
  ...goExtensions.map((extension) => [extension, 'go'] as const),
]);

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

function ensureFileExists(filePath: string): string {
  const absoluteFilePath = normalizeFilePath(resolveProjectPath(filePath));
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return absoluteFilePath;
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
