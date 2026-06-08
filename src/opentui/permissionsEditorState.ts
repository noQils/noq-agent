import {
  resolveCommandPermission,
} from '../commandPolicy';
import { getConfig } from '../config/config';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';
import { getSessionPermissionOverrides } from '../session/sessionStore';
import { type OpenTuiPermissionItem } from './openTuiTypes';

const permissionScopes: PermissionScope[] = [
  'read',
  'edit',
  'list',
  'glob',
  'grep',
  'bash',
  'external_directory',
];

const permissionCycle: PermissionOutcome[] = ['ask', 'allow', 'deny'];

function getPermissionScopeDescription(scope: PermissionScope): string {
  switch (scope) {
    case 'read':
      return 'Read file contents';
    case 'edit':
      return 'Create or modify files';
    case 'list':
      return 'List directory contents';
    case 'glob':
      return 'Find files by pattern';
    case 'grep':
      return 'Search text across files';
    case 'bash':
      return 'Run shell commands';
    case 'external_directory':
      return 'Access paths outside the workspace';
    case 'todo':
      return 'Manage the internal todo list';
  }
}

export function formatPermissionScopeLabel(scope: PermissionScope): string {
  return scope.replaceAll('_', ' ');
}

export function getBashWorkspaceOutcome(): PermissionOutcome {
  const bashPermission = getConfig().permission.bash;
  if (typeof bashPermission === 'string') {
    return bashPermission;
  }

  return resolveCommandPermission('*', bashPermission).outcome;
}

export function getPermissionsEditorItems(sessionId: string | null): OpenTuiPermissionItem[] {
  const config = getConfig();
  const sessionOverrides = sessionId ? getSessionPermissionOverrides(sessionId) : {};

  return permissionScopes.map((scope) => {
    const sessionOverride = sessionOverrides[scope];

    if (scope === 'bash') {
      return {
        scope,
        outcome: sessionOverride ?? getBashWorkspaceOutcome(),
        scopeDescription: getPermissionScopeDescription(scope),
      };
    }

    return {
      scope,
      outcome: sessionOverride ?? config.permission[scope],
      scopeDescription: getPermissionScopeDescription(scope),
    };
  });
}

export function getNextPermissionOutcome(outcome: PermissionOutcome): PermissionOutcome {
  const currentIndex = permissionCycle.indexOf(outcome);
  return permissionCycle[(currentIndex + 1) % permissionCycle.length] ?? 'ask';
}
