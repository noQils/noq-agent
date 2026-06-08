import { isAgentMode } from '../agentMode';
import {
  isRuleBasedCommandPermission,
  resolveCommandPermission,
} from '../commandPolicy';
import { getConfig } from '../config/config';
import { type PermissionOutcome, type PermissionScope } from '../permissions/types';
import { getSessionPermissionOverrides } from '../session/sessionStore';
import { type OpenTuiPermissionItem } from './openTuiTypes';

export type SlashCommand =
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'connect' }
  | { type: 'models' }
  | { type: 'permissions' }
  | { type: 'exit' }
  | { type: 'diff' }
  | { type: 'undo' }
  | { type: 'plan_show' }
  | { type: 'mode'; mode: 'plan' | 'build' };

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
      const outcome = sessionOverride ?? getBashWorkspaceOutcome();
      const source = sessionOverride
        ? 'session'
        : (isRuleBasedCommandPermission(config.permission.bash) ? 'workspace_rules' : 'workspace');
      const description = sessionOverride
        ? 'Session-wide shell mode'
        : (source === 'workspace_rules' ? 'Workspace bash rules fallback' : 'Workspace shell mode');

      return {
        scope,
        outcome,
        source,
        scopeDescription: getPermissionScopeDescription(scope),
        description,
      };
    }

    return {
      scope,
      outcome: sessionOverride ?? config.permission[scope],
      source: sessionOverride ? 'session' : 'workspace',
      scopeDescription: getPermissionScopeDescription(scope),
      description: sessionOverride ? 'Session override active' : 'Workspace config default',
    };
  });
}

export function getNextPermissionOutcome(outcome: PermissionOutcome): PermissionOutcome {
  const currentIndex = permissionCycle.indexOf(outcome);
  return permissionCycle[(currentIndex + 1) % permissionCycle.length] ?? 'ask';
}

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

export function parseSlashCommand(inputLine: string): SlashCommand {
  if (inputLine === '/connect') {
    return { type: 'connect' };
  }

  if (inputLine === '/models') {
    return { type: 'models' };
  }

  if (inputLine === '/permissions') {
    return { type: 'permissions' };
  }

  if (inputLine === '/exit' || inputLine === '/quit') {
    return { type: 'exit' };
  }

  if (inputLine === '/diff') {
    return { type: 'diff' };
  }

  if (inputLine === '/undo') {
    return { type: 'undo' };
  }

  if (inputLine === '/plan show') {
    return { type: 'plan_show' };
  }

  if (isModeCommand(inputLine)) {
    const requestedMode = inputLine.slice('/mode'.length).trim();
    if (isAgentMode(requestedMode)) {
      return { type: 'mode', mode: requestedMode };
    }

    return { type: 'invalid' };
  }

  return inputLine.startsWith('/')
    ? { type: 'invalid' }
    : { type: 'none' };
}
