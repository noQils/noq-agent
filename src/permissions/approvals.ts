import { matchCommandPattern, normalizeCommand } from '../commandPolicy';
import {
  appendSessionPermissionApproval,
  getSessionPermissionApprovals,
  type SessionPermissionApproval,
} from '../sessionStore';
import { type PermissionRequest, type PermissionScope } from './types';

type StoredPermissionApproval = {
  scope: PermissionScope;
  targetPattern: string;
};

const transientPermissionApprovals = new Map<string, StoredPermissionApproval>();
let currentPermissionSessionId: string | undefined;

function getApprovalKey(approval: StoredPermissionApproval): string {
  return `${approval.scope}::${approval.targetPattern}`;
}

function normalizeApprovalTarget(scope: PermissionScope, target: string): string {
  const normalizedTarget = target.trim();
  if (scope === 'bash') {
    return normalizeCommand(normalizedTarget);
  }

  return normalizedTarget;
}

function toStoredApproval(request: PermissionRequest): StoredPermissionApproval {
  return {
    scope: request.scope,
    targetPattern: normalizeApprovalTarget(request.scope, request.target),
  };
}

function doesApprovalMatchTarget(
  scope: PermissionScope,
  targetPattern: string,
  target: string,
): boolean {
  const normalizedTarget = normalizeApprovalTarget(scope, target);
  if (scope === 'bash') {
    return matchCommandPattern(normalizedTarget, targetPattern);
  }

  return normalizedTarget === targetPattern;
}

function matchesRequest(
  approval: StoredPermissionApproval,
  request: PermissionRequest,
): boolean {
  return approval.scope === request.scope
    && doesApprovalMatchTarget(approval.scope, approval.targetPattern, request.target);
}

function toStoredSessionApproval(
  approval: SessionPermissionApproval,
): StoredPermissionApproval {
  return {
    scope: approval.scope,
    targetPattern: approval.targetPattern,
  };
}

export function resetPermissionApprovalState(): void {
  transientPermissionApprovals.clear();
  currentPermissionSessionId = undefined;
}

export function setPermissionApprovalSession(sessionId?: string): void {
  transientPermissionApprovals.clear();
  currentPermissionSessionId = sessionId;
}

export function hasPersistentPermissionSession(): boolean {
  return typeof currentPermissionSessionId === 'string' && currentPermissionSessionId.length > 0;
}

export function isPermissionPreApproved(request: PermissionRequest): boolean {
  for (const approval of transientPermissionApprovals.values()) {
    if (matchesRequest(approval, request)) {
      return true;
    }
  }

  if (!currentPermissionSessionId) {
    return false;
  }

  const sessionApprovals = getSessionPermissionApprovals(currentPermissionSessionId);
  return sessionApprovals.some((approval) => matchesRequest(toStoredSessionApproval(approval), request));
}

export function allowPermissionOnce(request: PermissionRequest): void {
  void request;
}

export function allowPermissionForSession(request: PermissionRequest): void {
  const approval = toStoredApproval(request);
  transientPermissionApprovals.set(getApprovalKey(approval), approval);

  if (!currentPermissionSessionId) {
    return;
  }

  appendSessionPermissionApproval(currentPermissionSessionId, approval);
}
