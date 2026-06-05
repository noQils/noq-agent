import path from 'node:path';

import { resolveCommandPermission } from '../commandPolicy';
import { getConfig } from '../config';
import { getCurrentPermissionSessionId } from './approvals';
import { getSessionApprovedExternalDirectories } from '../sessionStore';
import { type PermissionOutcome, type PermissionRequest, type PermissionScope } from './types';

export interface PermissionDecision {
  outcome: PermissionOutcome;
  scope: PermissionScope;
  reason: string;
}

function canonicalizePath(targetPath: string): string {
  return path.resolve(process.cwd(), targetPath);
}

function isInsideDirectory(targetPath: string, directory: string): boolean {
  const resolvedTargetPath = canonicalizePath(targetPath);
  const resolvedDirectory = canonicalizePath(directory);
  const relativePath = path.relative(resolvedDirectory, resolvedTargetPath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getApprovedExternalDirectories(): string[] {
  const sessionId = getCurrentPermissionSessionId();
  if (!sessionId) {
    return [];
  }

  return getSessionApprovedExternalDirectories(sessionId);
}

function isAllowedPathTarget(targetPath: string): boolean {
  if (isInsideDirectory(targetPath, process.cwd())) {
    return true;
  }

  return getApprovedExternalDirectories().some((directory) => isInsideDirectory(targetPath, directory));
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

function getPathTargetApprovalDirectory(request: PermissionRequest, pathTarget: string): string {
  const resolvedPath = canonicalizePath(pathTarget);
  const cwd = request.args.cwd;

  if (typeof cwd === 'string' && cwd.trim() && pathTarget === cwd) {
    return resolvedPath;
  }

  if (request.scope === 'read' || request.scope === 'edit') {
    return path.dirname(resolvedPath);
  }

  return resolvedPath;
}

export function getFirstDisallowedPathTarget(request: PermissionRequest): string | null {
  const pathTargets = getPathTargets(request);

  for (const pathTarget of pathTargets) {
    if (!isAllowedPathTarget(pathTarget)) {
      return pathTarget;
    }
  }

  return null;
}

export function getExternalDirectoryApprovalTarget(request: PermissionRequest): string | null {
  const pathTargets = getPathTargets(request);

  for (const pathTarget of pathTargets) {
    if (!isAllowedPathTarget(pathTarget)) {
      return getPathTargetApprovalDirectory(request, pathTarget);
    }
  }

  return null;
}

function getExternalDirectoryDecision(request: PermissionRequest): PermissionDecision | null {
  const config = getConfig();
  const pathTarget = getFirstDisallowedPathTarget(request);
  if (pathTarget) {
    const outcome = config.permission.external_directory;
    return {
      outcome,
      scope: 'external_directory',
      reason: `Path "${pathTarget}" resolves outside the workspace, so "external_directory" is configured as "${outcome}".`,
    };
  }

  return null;
}

export function evaluatePermission(request: PermissionRequest): PermissionDecision {
  const config = getConfig();
  const externalDirectoryDecision = getExternalDirectoryDecision(request);

  if (externalDirectoryDecision) {
    return externalDirectoryDecision;
  }

  if (request.scope === 'bash') {
    const commandDecision = resolveCommandPermission(request.target, config.permission.bash);
    const reason = commandDecision.matchedPattern
      ? `Command "${request.target}" matched bash permission rule "${commandDecision.matchedPattern}" with outcome "${commandDecision.outcome}".`
      : `No specific bash permission rule matched command "${request.target}", so the fallback outcome is "${commandDecision.outcome}".`;

    return {
      outcome: commandDecision.outcome,
      scope: request.scope,
      reason,
    };
  }

  const outcome = config.permission[request.scope] as PermissionOutcome;

  return {
    outcome,
    scope: request.scope,
    reason: `Permission scope "${request.scope}" is configured as "${outcome}" for tool "${request.toolName}".`,
  };
}
