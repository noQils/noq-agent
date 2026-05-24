import fs from 'node:fs';
import path from 'node:path';

import { getProjectFilePaths, resolveProjectPath } from './fileUtils';

export interface SessionFileChange {
  filePath: string;
  existedBefore: boolean;
  beforeContent?: string;
  existedAfter: boolean;
  afterContent?: string;
}

type FileState = {
  existed: boolean;
  content?: string;
};

type WorkspaceFileStates = Map<string, FileState>;

let trackedBeforeStates: Map<string, FileState> | undefined;

function normalizeTrackedFilePath(filePath: string): string {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return relativePath.replaceAll('\\', '/') || '.';
  }

  return absolutePath.replaceAll('\\', '/');
}

function readFileState(filePath: string): FileState {
  const resolvedPath = resolveProjectPath(filePath);
  if (!fs.existsSync(resolvedPath)) {
    return { existed: false };
  }

  return {
    existed: true,
    content: fs.readFileSync(resolvedPath, 'utf-8'),
  };
}

function scanWorkspaceFileStates(): WorkspaceFileStates {
  const workspaceFileStates: WorkspaceFileStates = new Map();

  for (const filePath of getProjectFilePaths()) {
    const normalizedPath = normalizeTrackedFilePath(filePath);
    workspaceFileStates.set(normalizedPath, readFileState(normalizedPath));
  }

  return workspaceFileStates;
}

function fileStatesAreEqual(left: FileState, right: FileState): boolean {
  return left.existed === right.existed && left.content === right.content;
}

export function beginSessionChangeTracking(): void {
  trackedBeforeStates = new Map();
}

export function resetSessionChangeTracking(): void {
  trackedBeforeStates = undefined;
}

export function recordMutationTargets(filePaths: string[]): void {
  if (!trackedBeforeStates) {
    return;
  }

  for (const filePath of filePaths) {
    if (!filePath.trim()) {
      continue;
    }

    const normalizedPath = normalizeTrackedFilePath(filePath);
    if (trackedBeforeStates.has(normalizedPath)) {
      continue;
    }

    trackedBeforeStates.set(normalizedPath, readFileState(normalizedPath));
  }
}

export function beginWorkspaceMutationTracking(): WorkspaceFileStates | null {
  if (!trackedBeforeStates) {
    return null;
  }

  return scanWorkspaceFileStates();
}

export function recordWorkspaceMutationChanges(beforeWorkspaceStates: WorkspaceFileStates | null): void {
  if (!trackedBeforeStates || !beforeWorkspaceStates) {
    return;
  }

  const afterWorkspaceStates = scanWorkspaceFileStates();
  const changedPaths = new Set<string>([
    ...beforeWorkspaceStates.keys(),
    ...afterWorkspaceStates.keys(),
  ]);

  for (const filePath of changedPaths) {
    if (trackedBeforeStates.has(filePath)) {
      continue;
    }

    const beforeState = beforeWorkspaceStates.get(filePath) ?? { existed: false };
    const afterState = afterWorkspaceStates.get(filePath) ?? { existed: false };

    if (fileStatesAreEqual(beforeState, afterState)) {
      continue;
    }

    trackedBeforeStates.set(filePath, beforeState);
  }
}

export function finishSessionChangeTracking(): SessionFileChange[] {
  if (!trackedBeforeStates) {
    return [];
  }

  const fileChanges: SessionFileChange[] = [];

  for (const [filePath, beforeState] of trackedBeforeStates.entries()) {
    const afterState = readFileState(filePath);
    if (beforeState.existed === afterState.existed && beforeState.content === afterState.content) {
      continue;
    }

    fileChanges.push({
      filePath,
      existedBefore: beforeState.existed,
      ...(beforeState.existed ? { beforeContent: beforeState.content ?? '' } : {}),
      existedAfter: afterState.existed,
      ...(afterState.existed ? { afterContent: afterState.content ?? '' } : {}),
    });
  }

  trackedBeforeStates = undefined;
  return fileChanges.sort((left, right) => left.filePath.localeCompare(right.filePath));
}
