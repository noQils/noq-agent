import { type FormattedDefinitionLocation } from '../analysis/definitionTypes';
import { type FormattedDiagnostic } from '../analysis/diagnosticsTypes';
import {
  ensureFileExists,
  findSymbolColumn,
  getSourceLine,
  normalizeFilePath,
  runCommand,
  toWorkspaceRelativePath,
} from './shared';

export const pythonExtensions = ['.py'];

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

export function getPythonDiagnostics(filePaths: string[]): FormattedDiagnostic[] {
  const diagnostics: FormattedDiagnostic[] = [];

  for (const filePath of filePaths) {
    const absoluteFilePath = ensureFileExists(filePath);
    const result = runCommand('python', ['-m', 'py_compile', absoluteFilePath], {
      missingMessage: 'Cannot collect python diagnostics because "python" is not installed.',
    });

    if (result.status === 0) {
      continue;
    }

    diagnostics.push(...parsePythonDiagnostics(result.stderr));
  }

  return diagnostics;
}

export function getPythonDefinition(options: {
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

  const result = runCommand('python', ['-c', script, absoluteFilePath, String(options.line), String(columnIndex)], {
    missingMessage: 'Cannot resolve python definitions because "python" is not installed.',
  });

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(message.length > 0 ? message : 'python exited with an error.');
  }

  const rawDefinitions = JSON.parse(result.stdout) as Array<{
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
