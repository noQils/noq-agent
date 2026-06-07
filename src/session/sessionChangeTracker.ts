import fs from 'node:fs';
import path from 'node:path';

import { getProjectFilePaths, resolveProjectPath } from '../fileUtils';
import { debugLog } from '../config/runtimeSettings';

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
export interface WorkspaceMutationTrackingSnapshot {
  roots: string[];
  states: WorkspaceFileStates;
}

export interface MutationChangeTrackingSnapshot {
  targetBeforeStates: Map<string, SessionFileState>;
  workspaceBeforeStates: WorkspaceMutationTrackingSnapshot | null;
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
  return scanWorkspaceFileStatesForRoots([process.cwd()]);
}

function normalizeWorkspaceRoots(workspaceRoots: string[]): string[] {
  return Array.from(
    new Set(
      workspaceRoots
        .map((workspaceRoot) => workspaceRoot.trim())
        .filter((workspaceRoot) => workspaceRoot.length > 0)
        .map((workspaceRoot) => path.resolve(process.cwd(), workspaceRoot)),
    ),
  );
}

function scanWorkspaceFileStatesForRoots(workspaceRoots: string[]): WorkspaceFileStates {
  const startedAt = Date.now();
  const workspaceFileStates: WorkspaceFileStates = new Map();
  const normalizedRoots = normalizeWorkspaceRoots(workspaceRoots);

  for (const workspaceRoot of normalizedRoots) {
    for (const filePath of getProjectFilePaths(workspaceRoot)) {
      const normalizedPath = normalizeTrackedFilePath(filePath);
      workspaceFileStates.set(normalizedPath, readFileState(normalizedPath));
    }
  }

  debugLog('Workspace file state scan completed:', {
    workspaceRootCount: normalizedRoots.length,
    fileCount: workspaceFileStates.size,
    durationMs: Date.now() - startedAt,
  });
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
  beforeWorkspaceSnapshot: WorkspaceMutationTrackingSnapshot,
): Map<string, SessionFileState> {
  const afterWorkspaceStates = scanWorkspaceFileStatesForRoots(beforeWorkspaceSnapshot.roots);
  const changedBeforeStates = new Map<string, SessionFileState>();
  const changedPaths = new Set<string>([
    ...beforeWorkspaceSnapshot.states.keys(),
    ...afterWorkspaceStates.keys(),
  ]);

  for (const filePath of changedPaths) {
    const beforeState = beforeWorkspaceSnapshot.states.get(filePath) ?? { existed: false };
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
  debugLog('Session change tracking started.');
}

export function resetSessionChangeTracking(): void {
  trackedBeforeStates = undefined;
  debugLog('Session change tracking reset.');
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
    debugLog('Session mutation target recorded:', { filePath: normalizedPath });
  }
}

export function beginMutationChangeTracking(
  filePaths: string[],
  workspaceBeforeStates: WorkspaceMutationTrackingSnapshot | null,
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

export function beginWorkspaceMutationTracking(workspaceRoots: string[] = [process.cwd()]): WorkspaceMutationTrackingSnapshot | null {
  if (!trackedBeforeStates) {
    debugLog('Workspace mutation tracking skipped: no active session tracking.');
    return null;
  }

  const normalizedRoots = normalizeWorkspaceRoots(workspaceRoots);
  debugLog('Workspace mutation tracking started.', {
    workspaceRootCount: normalizedRoots.length,
  });
  return {
    roots: normalizedRoots,
    states: scanWorkspaceFileStatesForRoots(normalizedRoots),
  };
}

export function recordWorkspaceMutationChanges(beforeWorkspaceStates: WorkspaceMutationTrackingSnapshot | null): void {
  if (!trackedBeforeStates || !beforeWorkspaceStates) {
    return;
  }

  let recordedChangeCount = 0;
  for (const [filePath, beforeState] of collectWorkspaceChangedBeforeStates(beforeWorkspaceStates)) {
    if (trackedBeforeStates.has(filePath)) {
      continue;
    }

    trackedBeforeStates.set(filePath, beforeState);
    recordedChangeCount++;
  }

  debugLog('Workspace mutation changes recorded:', { recordedChangeCount });
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

  const fileChanges = buildFileChangesFromBeforeStates(beforeStates);
  debugLog('Mutation change tracking finished:', {
    beforeStateCount: beforeStates.size,
    fileChangeCount: fileChanges.length,
  });
  return fileChanges;
}

export function finishSessionChangeTracking(): SessionFileChange[] {
  if (!trackedBeforeStates) {
    return [];
  }

  const fileChanges = buildFileChangesFromBeforeStates(trackedBeforeStates);
  trackedBeforeStates = undefined;
  debugLog('Session change tracking finished:', {
    fileChangeCount: fileChanges.length,
  });
  return fileChanges;
}
