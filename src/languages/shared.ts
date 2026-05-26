import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { resolveProjectPath } from '../fileUtils';

export function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath);
}

export function toWorkspaceRelativePath(filePath: string): string {
  const workspaceRoot = path.resolve(process.cwd());
  const relativePath = path.relative(workspaceRoot, filePath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return relativePath.replaceAll('\\', '/') || '.';
  }

  return filePath.replaceAll('\\', '/');
}

export function splitFileLines(content: string): string[] {
  return content.replaceAll('\r\n', '\n').split('\n');
}

export function validatePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

export function ensureFileExists(filePath: string): string {
  const absoluteFilePath = normalizeFilePath(resolveProjectPath(filePath));
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  return absoluteFilePath;
}

export function getSourceLine(filePath: string, lineNumber: number): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = splitFileLines(content);
  return lines[lineNumber - 1] ?? '';
}

export function findSymbolColumn(lineText: string, symbol: string, occurrence: number): number {
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

export function ensureCommandAvailable(command: string, missingMessage: string, shell = false): void {
  const result = spawnSync(command, ['--version'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    shell,
  });

  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    throw new Error(missingMessage);
  }
}

export function runCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    shell?: boolean;
    missingMessage?: string;
  },
): SpawnSyncReturns<string> {
  const cwd = options?.cwd ?? process.cwd();
  const shell = options?.shell ?? false;

  if (options?.missingMessage) {
    ensureCommandAvailable(command, options.missingMessage, shell);
  }

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
