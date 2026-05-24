import path from 'node:path';

import { getConfig } from '../config';
import { type PermissionOutcome, type PermissionRequest, type PermissionScope } from './types';

export interface PermissionDecision {
  outcome: PermissionOutcome;
  scope: PermissionScope;
  reason: string;
}

function isInsideWorkspace(targetPath: string): boolean {
  const workspaceRoot = path.resolve(process.cwd());
  const resolvedTargetPath = path.resolve(process.cwd(), targetPath);
  const relativePath = path.relative(workspaceRoot, resolvedTargetPath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getPathTargets(request: PermissionRequest): string[] {
  const pathTargets: string[] = [];

  if (request.scope === 'read' || request.scope === 'edit' || request.scope === 'list') {
    pathTargets.push(request.target);
  }

  if (Array.isArray(request.pathTargets)) {
    for (const pathTarget of request.pathTargets) {
      if (typeof pathTarget === 'string' && pathTarget.trim()) {
        pathTargets.push(pathTarget);
      }
    }
  }

  const cwd = request.args.cwd;
  if (typeof cwd === 'string' && cwd.trim()) {
    pathTargets.push(cwd);
  }

  return pathTargets.filter(Boolean);
}

function getExternalDirectoryDecision(request: PermissionRequest): PermissionDecision | null {
  const config = getConfig();
  const pathTargets = getPathTargets(request);

  for (const pathTarget of pathTargets) {
    if (!isInsideWorkspace(pathTarget)) {
      const outcome = config.permission.external_directory;
      return {
        outcome,
        scope: 'external_directory',
        reason: `Path "${pathTarget}" resolves outside the workspace, so "external_directory" is configured as "${outcome}".`,
      };
    }
  }

  return null;
}

export function evaluatePermission(request: PermissionRequest): PermissionDecision {
  const config = getConfig();
  const externalDirectoryDecision = getExternalDirectoryDecision(request);

  if (externalDirectoryDecision) {
    return externalDirectoryDecision;
  }

  const outcome = config.permission[request.scope];

  return {
    outcome,
    scope: request.scope,
    reason: `Permission scope "${request.scope}" is configured as "${outcome}" for tool "${request.toolName}".`,
  };
}
