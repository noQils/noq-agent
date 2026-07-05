import fs from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import { type FormattedDefinitionLocation } from '../analysis/definitionTypes';
import { type FormattedDiagnostic } from '../analysis/diagnosticsTypes';
import { type RenameFileEdit } from '../analysis/renameTypes';
import { getProjectFilePaths, resolveProjectPath } from '../fileUtils';
import {
  ensureFileExists,
  findSymbolColumn,
  getSourceLine,
  normalizeFilePath,
  splitFileLines,
  toWorkspaceRelativePath,
  validatePositiveInteger,
} from './shared';

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

interface LoadedTypeScriptProject {
  languageService: ts.LanguageService;
  rootFileNames: string[];
  configDiagnostics: readonly ts.Diagnostic[];
}

function isSupportedScriptFile(filePath: string): boolean {
  return supportedScriptExtensions.some((extension) => filePath.endsWith(extension));
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
    language: 'typescript',
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
    const fileDiagnostics = [
      ...project.languageService.getSyntacticDiagnostics(fileName),
      ...project.languageService.getSemanticDiagnostics(fileName),
      ...(includeSuggestions
        ? project.languageService.getSuggestionDiagnostics(fileName)
        : []),
    ];

    diagnostics.push(...fileDiagnostics);
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

export function getTypeScriptDiagnostics(options?: {
  filePath?: string;
  includeSuggestions?: boolean;
  maxDiagnostics?: number;
}): FormattedDiagnostic[] {
  const filePath = options?.filePath;
  const includeSuggestions = options?.includeSuggestions ?? false;
  const maxDiagnostics = validateMaxDiagnostics(options?.maxDiagnostics ?? defaultMaxDiagnostics);

  if (filePath) {
    ensureFileExists(filePath);
  }

  const project = loadTypeScriptProject(filePath);
  const fileNames = filePath
    ? [normalizeFilePath(resolveProjectPath(filePath))]
    : project.rootFileNames;

  const diagnostics = collectDiagnosticsForFiles(project, fileNames, includeSuggestions)
    .map(formatDiagnostic);

  return dedupeDiagnostics(diagnostics).slice(0, maxDiagnostics);
}

function resolveTypeScriptPosition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence?: number;
}): { project: LoadedTypeScriptProject; absoluteFilePath: string; position: number } {
  validatePositiveInteger(options.line, 'line');

  const occurrence = options.occurrence ?? 1;
  validatePositiveInteger(occurrence, 'occurrence');

  if (!options.symbol.trim()) {
    throw new Error('symbol must be a non-empty string.');
  }

  const absoluteFilePath = ensureFileExists(options.filePath);
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

  return { project, absoluteFilePath, position };
}

export function goToTypeScriptDefinition(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence?: number;
}): FormattedDefinitionLocation[] {
  const { project, absoluteFilePath, position } = resolveTypeScriptPosition(options);
  const program = project.languageService.getProgram();
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

export function findTypeScriptReferences(options: {
  filePath: string;
  line: number;
  symbol: string;
  occurrence?: number;
}): FormattedDefinitionLocation[] {
  const { project, absoluteFilePath, position } = resolveTypeScriptPosition(options);
  const program = project.languageService.getProgram();
  const referencedSymbols = project.languageService.findReferences(absoluteFilePath, position) ?? [];

  return referencedSymbols.flatMap((referencedSymbol) => referencedSymbol.references.map((reference) => {
    const referenceSourceFile = program?.getSourceFile(reference.fileName);
    if (!referenceSourceFile) {
      throw new Error(`TypeScript could not load reference file: ${reference.fileName}`);
    }

    const lineCharacter = referenceSourceFile.getLineAndCharacterOfPosition(reference.textSpan.start);
    return {
      filePath: toWorkspaceRelativePath(normalizeFilePath(reference.fileName)),
      line: lineCharacter.line + 1,
      column: lineCharacter.character + 1,
      lineText: getSourceLine(reference.fileName, lineCharacter.line + 1),
    };
  }));
}

export function planTypeScriptRename(options: {
  filePath: string;
  line: number;
  symbol: string;
  newName: string;
  occurrence?: number;
}): RenameFileEdit[] {
  if (!options.newName.trim()) {
    throw new Error('newName must be a non-empty string.');
  }

  const { project, absoluteFilePath, position } = resolveTypeScriptPosition(options);
  const renameInfo = project.languageService.getRenameInfo(absoluteFilePath, position, {
    allowRenameOfImportPath: false,
  });

  if (!renameInfo.canRename) {
    throw new Error(renameInfo.localizedErrorMessage);
  }

  const renameLocations = project.languageService.findRenameLocations(
    absoluteFilePath,
    position,
    false,
    false,
    false,
  ) ?? [];

  const locationsByFile = new Map<string, ts.RenameLocation[]>();
  for (const location of renameLocations) {
    const existing = locationsByFile.get(location.fileName);
    if (existing) {
      existing.push(location);
    } else {
      locationsByFile.set(location.fileName, [location]);
    }
  }

  const edits: RenameFileEdit[] = [];
  for (const [fileName, locations] of locationsByFile) {
    let content = fs.readFileSync(fileName, 'utf-8');
    const sortedLocations = [...locations].sort((a, b) => b.textSpan.start - a.textSpan.start);

    for (const location of sortedLocations) {
      const start = location.textSpan.start;
      const end = start + location.textSpan.length;
      content = content.slice(0, start) + options.newName + content.slice(end);
    }

    const absolutePath = normalizeFilePath(fileName);
    edits.push({
      absoluteFilePath: absolutePath,
      relativeFilePath: toWorkspaceRelativePath(absolutePath),
      newContent: content,
    });
  }

  return edits;
}
