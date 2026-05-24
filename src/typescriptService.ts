import fs from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import { getProjectFilePaths, resolveProjectPath } from './fileUtils';

const supportedScriptExtensions = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.d.mts',
  '.d.cts',
];

const defaultMaxDiagnostics = 100;
const maxAllowedDiagnostics = 500;

export interface FormattedDiagnostic {
  filePath?: string;
  line?: number;
  column?: number;
  code: number;
  category: string;
  message: string;
}

export interface FormattedDefinitionLocation {
  filePath: string;
  line: number;
  column: number;
  lineText: string;
}

interface LoadedTypeScriptProject {
  languageService: ts.LanguageService;
  rootFileNames: string[];
  configDiagnostics: readonly ts.Diagnostic[];
}

function isSupportedScriptFile(filePath: string): boolean {
  return supportedScriptExtensions.some((extension) => filePath.endsWith(extension));
}

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

function buildFallbackCompilerOptions(): ts.CompilerOptions {
  return {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  };
}

function loadConfiguredProject(): {
  compilerOptions: ts.CompilerOptions;
  rootFileNames: string[];
  configDiagnostics: readonly ts.Diagnostic[];
} | null {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    return null;
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return {
      compilerOptions: buildFallbackCompilerOptions(),
      rootFileNames: [],
      configDiagnostics: [configFile.error],
    };
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  return {
    compilerOptions: parsedConfig.options,
    rootFileNames: parsedConfig.fileNames.filter(isSupportedScriptFile).map(normalizeFilePath),
    configDiagnostics: parsedConfig.errors,
  };
}

function loadFallbackProject(targetFilePath?: string): {
  compilerOptions: ts.CompilerOptions;
  rootFileNames: string[];
  configDiagnostics: readonly ts.Diagnostic[];
} {
  const projectFiles = getProjectFilePaths()
    .filter(isSupportedScriptFile)
    .map((filePath) => normalizeFilePath(resolveProjectPath(filePath)));

  if (targetFilePath && isSupportedScriptFile(targetFilePath)) {
    projectFiles.push(normalizeFilePath(targetFilePath));
  }

  return {
    compilerOptions: buildFallbackCompilerOptions(),
    rootFileNames: projectFiles,
    configDiagnostics: [],
  };
}

function createLanguageService(rootFileNames: string[], compilerOptions: ts.CompilerOptions): ts.LanguageService {
  const uniqueRootFileNames = [...new Set(rootFileNames)];
  const scriptVersions = new Map(uniqueRootFileNames.map((filePath) => [filePath, '0']));

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => uniqueRootFileNames,
    getScriptVersion: (fileName) => scriptVersions.get(normalizeFilePath(fileName)) ?? '0',
    getScriptSnapshot: (fileName) => {
      if (!fs.existsSync(fileName)) {
        return undefined;
      }

      return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf-8'));
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    ...(ts.sys.realpath ? { realpath: ts.sys.realpath } : {}),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function loadTypeScriptProject(targetFilePath?: string): LoadedTypeScriptProject {
  const normalizedTargetFilePath = targetFilePath
    ? normalizeFilePath(resolveProjectPath(targetFilePath))
    : undefined;

  const configuredProject = loadConfiguredProject();
  const project = configuredProject ?? loadFallbackProject(normalizedTargetFilePath);
  const rootFileNames = [...project.rootFileNames];

  if (normalizedTargetFilePath && !rootFileNames.includes(normalizedTargetFilePath)) {
    rootFileNames.push(normalizedTargetFilePath);
  }

  return {
    languageService: createLanguageService(rootFileNames, project.compilerOptions),
    rootFileNames,
    configDiagnostics: project.configDiagnostics,
  };
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

function formatDiagnosticCategory(category: ts.DiagnosticCategory): string {
  return ts.DiagnosticCategory[category].toLowerCase();
}

function formatDiagnostic(diagnostic: ts.Diagnostic): FormattedDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const result: FormattedDiagnostic = {
    code: diagnostic.code,
    category: formatDiagnosticCategory(diagnostic.category),
    message,
  };

  if (!diagnostic.file || diagnostic.start === undefined) {
    return result;
  }

  const lineCharacter = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  result.filePath = toWorkspaceRelativePath(normalizeFilePath(diagnostic.file.fileName));
  result.line = lineCharacter.line + 1;
  result.column = lineCharacter.character + 1;

  return result;
}

function collectDiagnosticsForFiles(
  project: LoadedTypeScriptProject,
  fileNames: string[],
  includeSuggestions: boolean,
): ts.Diagnostic[] {
  const diagnostics: ts.Diagnostic[] = [
    ...project.configDiagnostics,
    ...project.languageService.getCompilerOptionsDiagnostics(),
  ];

  for (const fileName of fileNames) {
    diagnostics.push(...project.languageService.getSyntacticDiagnostics(fileName));
    diagnostics.push(...project.languageService.getSemanticDiagnostics(fileName));

    if (includeSuggestions) {
      diagnostics.push(...project.languageService.getSuggestionDiagnostics(fileName));
    }
  }

  return diagnostics;
}

function dedupeDiagnostics(diagnostics: FormattedDiagnostic[]): FormattedDiagnostic[] {
  const seen = new Set<string>();
  const deduped: FormattedDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
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

function splitFileLines(content: string): string[] {
  return content.replaceAll('\r\n', '\n').split('\n');
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

  throw new Error(
    `Could not find occurrence ${occurrence} of symbol "${symbol}" on the requested line.`,
  );
}

function getSourceLine(filePath: string, lineNumber: number): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = splitFileLines(content);
  return lines[lineNumber - 1] ?? '';
}

export function getTypeScriptDiagnostics(options?: {
  filePath?: string;
  includeSuggestions?: boolean;
  maxDiagnostics?: number;
}): FormattedDiagnostic[] {
  const filePath = options?.filePath;
  const includeSuggestions = options?.includeSuggestions ?? false;
  const maxDiagnostics = validateMaxDiagnostics(options?.maxDiagnostics ?? defaultMaxDiagnostics);

  if (filePath && !fs.existsSync(resolveProjectPath(filePath))) {
    throw new Error(`File not found: ${filePath}`);
  }

  const project = loadTypeScriptProject(filePath);
  const fileNames = filePath
    ? [normalizeFilePath(resolveProjectPath(filePath))]
    : project.rootFileNames;

  const diagnostics = collectDiagnosticsForFiles(project, fileNames, includeSuggestions)
    .map(formatDiagnostic);

  return dedupeDiagnostics(diagnostics).slice(0, maxDiagnostics);
}

export function goToTypeScriptDefinition(options: {
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

  const absoluteFilePath = normalizeFilePath(resolveProjectPath(options.filePath));
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${options.filePath}`);
  }

  const project = loadTypeScriptProject(options.filePath);
  const program = project.languageService.getProgram();
  const sourceFile = program?.getSourceFile(absoluteFilePath);
  if (!sourceFile) {
    throw new Error(`TypeScript could not load source file: ${options.filePath}`);
  }

  const lineText = getSourceLine(absoluteFilePath, options.line);
  if (lineText.length === 0 && options.line > splitFileLines(sourceFile.text).length) {
    throw new Error(`Line ${options.line} is outside the file.`);
  }

  const columnIndex = findSymbolColumn(lineText, options.symbol, occurrence);
  const position = sourceFile.getPositionOfLineAndCharacter(options.line - 1, columnIndex);
  const definitions = project.languageService.getDefinitionAtPosition(absoluteFilePath, position) ?? [];

  return definitions.map((definition) => {
    const definitionSourceFile = program?.getSourceFile(definition.fileName);
    if (!definitionSourceFile) {
      throw new Error(`TypeScript could not load definition file: ${definition.fileName}`);
    }

    const lineCharacter = definitionSourceFile.getLineAndCharacterOfPosition(definition.textSpan.start);
    return {
      filePath: toWorkspaceRelativePath(normalizeFilePath(definition.fileName)),
      line: lineCharacter.line + 1,
      column: lineCharacter.character + 1,
      lineText: getSourceLine(definition.fileName, lineCharacter.line + 1),
    };
  });
}
