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

export type SessionFileState = {
  existed: boolean;
  content?: string;
};

export type WorkspaceFileStates = Map<string, SessionFileState>;

export interface MutationChangeTrackingSnapshot {
  targetBeforeStates: Map<string, SessionFileState>;
  workspaceBeforeStates: WorkspaceFileStates | null;
}

let trackedBeforeStates: Map<string, SessionFileState> | undefined;

function normalizeTrackedFilePath(filePath: string): string {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return relativePath.replaceAll('\\', '/') || '.';
  }

  return absolutePath.replaceAll('\\', '/');
}

function readFileState(filePath: string): SessionFileState {
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

function fileStatesAreEqual(left: SessionFileState, right: SessionFileState): boolean {
  return left.existed === right.existed && left.content === right.content;
}

function buildFileChangesFromBeforeStates(
  beforeStates: Map<string, SessionFileState>,
): SessionFileChange[] {
  const fileChanges: SessionFileChange[] = [];

  for (const [filePath, beforeState] of beforeStates.entries()) {
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

  return fileChanges.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function collectWorkspaceChangedBeforeStates(
  beforeWorkspaceStates: WorkspaceFileStates,
): Map<string, SessionFileState> {
  const afterWorkspaceStates = scanWorkspaceFileStates();
  const changedBeforeStates = new Map<string, SessionFileState>();
  const changedPaths = new Set<string>([
    ...beforeWorkspaceStates.keys(),
    ...afterWorkspaceStates.keys(),
  ]);

  for (const filePath of changedPaths) {
    const beforeState = beforeWorkspaceStates.get(filePath) ?? { existed: false };
    const afterState = afterWorkspaceStates.get(filePath) ?? { existed: false };

    if (fileStatesAreEqual(beforeState, afterState)) {
      continue;
    }

    changedBeforeStates.set(filePath, beforeState);
  }

  return changedBeforeStates;
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

export function beginMutationChangeTracking(
  filePaths: string[],
  workspaceBeforeStates: WorkspaceFileStates | null,
): MutationChangeTrackingSnapshot {
  const targetBeforeStates = new Map<string, SessionFileState>();

  for (const filePath of filePaths) {
    if (!filePath.trim()) {
      continue;
    }

    const normalizedPath = normalizeTrackedFilePath(filePath);
    if (!targetBeforeStates.has(normalizedPath)) {
      targetBeforeStates.set(normalizedPath, readFileState(normalizedPath));
    }
  }

  return {
    targetBeforeStates,
    workspaceBeforeStates,
  };
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

  for (const [filePath, beforeState] of collectWorkspaceChangedBeforeStates(beforeWorkspaceStates)) {
    if (trackedBeforeStates.has(filePath)) {
      continue;
    }

    trackedBeforeStates.set(filePath, beforeState);
  }
}

export function finishMutationChangeTracking(
  snapshot: MutationChangeTrackingSnapshot,
): SessionFileChange[] {
  const beforeStates = new Map(snapshot.targetBeforeStates);

  if (snapshot.workspaceBeforeStates) {
    for (const [filePath, beforeState] of collectWorkspaceChangedBeforeStates(snapshot.workspaceBeforeStates)) {
      if (!beforeStates.has(filePath)) {
        beforeStates.set(filePath, beforeState);
      }
    }
  }

  return buildFileChangesFromBeforeStates(beforeStates);
}

export function finishSessionChangeTracking(): SessionFileChange[] {
  if (!trackedBeforeStates) {
    return [];
  }

  const fileChanges = buildFileChangesFromBeforeStates(trackedBeforeStates);
  trackedBeforeStates = undefined;
  return fileChanges;
}
