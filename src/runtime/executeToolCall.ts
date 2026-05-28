import { type AgentMode } from '../agentMode';
import {
  allowPermissionForSession,
  allowPermissionOnce,
  isPermissionPreApproved,
} from '../permissions/approvals';
import { evaluatePermission } from '../permissions/evaluate';
import { promptForPermission } from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
import { canonicalizeArgsValue } from '../providers/shared/toolFingerprint';
import {
  beginMutationChangeTracking,
  beginWorkspaceMutationTracking,
  finishMutationChangeTracking,
  recordMutationTargets,
  recordWorkspaceMutationChanges,
  type MutationChangeTrackingSnapshot,
} from '../sessionChangeTracker';
import { buildSessionFileDiff } from '../sessionDiff';
import { getToolByName } from '../tools';
import { type ExecutedToolCall, type ToolMutationCallback } from '../providers/types';

export interface ToolExecutionResult {
  output: string;
  executedToolCall: ExecutedToolCall;
}

export interface ToolExecutionOptions {
  mode?: AgentMode;
  onMutation?: ToolMutationCallback;
}

const permissionDecisionCache = new Map<string, boolean>();

function getPermissionRequestCacheKey(request: PermissionRequest): string {
  return canonicalizeArgsValue({
    scope: request.scope,
    toolName: request.toolName,
    target: request.target,
    args: request.args,
  });
}

function buildPermissionRequest(
  toolName: string,
  args: Record<string, unknown>,
): PermissionRequest | null {
  const tool = getToolByName(toolName);
  if (!tool) {
    return null;
  }

  const pathTargets = tool.permission.getPathTargets?.(args);

  return {
    scope: tool.permission.scope,
    toolName: tool.name,
    target: tool.permission.getTarget(args),
    args,
    ...(pathTargets ? { pathTargets } : {}),
  };
}

export function resetPermissionDecisionCache(): void {
  permissionDecisionCache.clear();
}

function getMutationTargets(
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  const tool = getToolByName(toolName);
  if (!tool || tool.permission.scope !== 'edit') {
    return [];
  }

  const targets = tool.permission.getPathTargets?.(args) ?? [];
  if (targets.length > 0) {
    return Array.from(new Set(targets.filter((target) => typeof target === 'string' && target.trim())));
  }

  const target = tool.permission.getTarget(args);
  return typeof target === 'string' && target.trim() ? [target] : [];
}

function shouldTrackWorkspaceChanges(
  toolName: string,
): boolean {
  return toolName === 'run_command';
}

async function notifyMutation(
  toolName: string,
  args: Record<string, unknown>,
  executedToolCall: ExecutedToolCall,
  snapshot: MutationChangeTrackingSnapshot | null,
  onMutation: ToolMutationCallback | undefined,
): Promise<void> {
  if (!snapshot || !onMutation) {
    return;
  }

  const fileChanges = finishMutationChangeTracking(snapshot);
  if (fileChanges.length === 0) {
    return;
  }

  const diff = buildSessionFileDiff(fileChanges);
  if (diff.trim().length === 0) {
    return;
  }

  try {
    await onMutation({
      toolName,
      args,
      executedToolCall,
      fileChanges,
      diff,
    });
  } catch {
    // UI mutation notifications should never change tool execution semantics.
  }
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
): Promise<ToolExecutionResult> {
  const tool = getToolByName(toolName);

  if (!tool) {
    const error = `Unknown tool: ${toolName}`;
    return {
      output: error,
      executedToolCall: {
        toolName,
        args,
        succeeded: false,
        error,
        failureKind: 'unknown_tool',
      },
    };
  }

  const mode = options?.mode;
  if (mode && !tool.allowedModes.includes(mode)) {
    const target = tool.permission.getTarget(args);
    const error =
      `Tool "${toolName}" is not available in ${mode} mode. ` +
      'Do not retry this action in this turn unless the mode changes.';
    return {
      output: error,
      executedToolCall: {
        toolName,
        args,
        succeeded: false,
        error,
        failureKind: 'mode_denied',
        target,
        blockedByMode: mode,
      },
    };
  }

  const permissionRequest = buildPermissionRequest(toolName, args);
  if (!permissionRequest) {
    const error = `Failed to build permission request for tool: ${toolName}`;
    return {
      output: error,
      executedToolCall: {
        toolName,
        args,
        succeeded: false,
        error,
        failureKind: 'tool_error',
      },
    };
  }

  const permissionDecision = evaluatePermission(permissionRequest);
  if (permissionDecision.outcome === 'deny') {
    const error =
      `Permission denied: ${permissionDecision.reason} ` +
      'Do not retry this action in this turn unless the user changes the permission configuration.';
    return {
      output: error,
      executedToolCall: {
        toolName,
        args,
        succeeded: false,
        error,
        failureKind: 'permission_denied',
        permissionScope: permissionRequest.scope,
        target: permissionRequest.target,
        permissionDeniedBy: 'policy',
      },
    };
  }

  if (permissionDecision.outcome === 'ask') {
    const cacheKey = getPermissionRequestCacheKey(permissionRequest);
    const cachedDecision = permissionDecisionCache.get(cacheKey);
    let allowed = cachedDecision ?? false;

    if (cachedDecision === undefined) {
      if (isPermissionPreApproved(permissionRequest)) {
        allowed = true;
      } else {
        const promptDecision = await promptForPermission(permissionRequest);
        if (promptDecision === 'allow_session') {
          allowPermissionForSession(permissionRequest);
          allowed = true;
        } else if (promptDecision === 'allow_once') {
          allowPermissionOnce(permissionRequest);
          allowed = true;
        }
      }
    }

    permissionDecisionCache.set(cacheKey, allowed);

    if (!allowed) {
      const error =
        `Permission rejected by user for tool "${toolName}" on target "${permissionRequest.target}". ` +
        'Do not retry this action in this turn unless the user explicitly grants permission.';
      return {
        output: error,
        executedToolCall: {
          toolName,
          args,
          succeeded: false,
          error,
          failureKind: 'permission_denied',
          permissionScope: permissionRequest.scope,
          target: permissionRequest.target,
          permissionDeniedBy: 'user',
        },
      };
    }
  }

  const mutationTargets = getMutationTargets(toolName, args);
  const shouldTrackWorkspace = shouldTrackWorkspaceChanges(toolName);
  const workspaceMutationSnapshot = shouldTrackWorkspace
    ? beginWorkspaceMutationTracking()
    : null;
  const mutationSnapshot = options?.onMutation && (mutationTargets.length > 0 || shouldTrackWorkspace)
    ? beginMutationChangeTracking(mutationTargets, workspaceMutationSnapshot)
    : null;

  try {
    recordMutationTargets(mutationTargets);
    const result = await tool.execute(args);
    recordWorkspaceMutationChanges(workspaceMutationSnapshot);
    const executedToolCall: ExecutedToolCall = {
      toolName,
      args,
      succeeded: true,
    };
    await notifyMutation(
      toolName,
      args,
      executedToolCall,
      mutationSnapshot,
      options?.onMutation,
    );
    return {
      output: String(result),
      executedToolCall,
    };
  } catch (error) {
    recordWorkspaceMutationChanges(workspaceMutationSnapshot);
    const message = error instanceof Error ? error.message : String(error);
    const executedToolCall: ExecutedToolCall = {
      toolName,
      args,
      succeeded: false,
      error: message,
      failureKind: 'tool_error',
    };
    await notifyMutation(
      toolName,
      args,
      executedToolCall,
      mutationSnapshot,
      options?.onMutation,
    );
    return {
      output: message,
      executedToolCall,
    };
  }
}
