import { type AgentMode } from '../agentMode';
import {
  allowPermissionForSession,
  allowPermissionOnce,
  isPermissionPreApproved,
} from '../permissions/approvals';
import {
  getCachedPermissionDecision,
  resetPermissionDecisionCache as resetSharedPermissionDecisionCache,
  setCachedPermissionDecision,
} from '../permissions/decisionCache';
import { evaluatePermission, getExternalDirectoryApprovalTarget } from '../permissions/evaluate';
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
} from '../session/sessionChangeTracker';
import { buildSessionFileDiff } from '../session/sessionDiff';
import { getToolByName } from '../tools';
import { type ExecutedToolCall, type ToolMutationCallback } from '../providers/types';
import { debugLog } from '../config/runtimeSettings';

export interface ToolExecutionResult {
  output: string;
  executedToolCall: ExecutedToolCall;
}

export interface ToolExecutionOptions {
  mode?: AgentMode;
  onMutation?: ToolMutationCallback;
}

function getPermissionRequestCacheKey(request: PermissionRequest): string {
  return canonicalizeArgsValue({
    scope: request.scope,
    toolName: request.toolName,
    target: request.target,
    args: request.args,
  });
}

function getApprovalRequest(
  permissionRequest: PermissionRequest,
  permissionScope: PermissionRequest['scope'],
): PermissionRequest {
  if (permissionScope !== 'external_directory') {
    return permissionRequest;
  }

  const approvalTarget = getExternalDirectoryApprovalTarget(permissionRequest);
  if (!approvalTarget) {
    return permissionRequest;
  }

  return {
    ...permissionRequest,
    scope: 'external_directory',
    target: approvalTarget,
  };
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
  resetSharedPermissionDecisionCache();
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

function getWorkspaceMutationRoots(
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  if (toolName !== 'run_command') {
    return [process.cwd()];
  }

  const roots = [process.cwd()];
  const cwd = typeof args.cwd === 'string' ? args.cwd.trim() : '';
  if (cwd.length > 0) {
    roots.push(cwd);
  }

  return Array.from(new Set(roots));
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
    debugLog('Mutation notification skipped: no file changes.', { toolName });
    return;
  }

  const diff = buildSessionFileDiff(fileChanges);
  if (diff.trim().length === 0) {
    debugLog('Mutation notification skipped: empty diff.', {
      toolName,
      fileChangeCount: fileChanges.length,
    });
    return;
  }

  try {
    debugLog('Mutation notification:', {
      toolName,
      succeeded: executedToolCall.succeeded,
      fileChangeCount: fileChanges.length,
      diffLength: diff.length,
    });
    await onMutation({
      toolName,
      args,
      executedToolCall,
      fileChanges,
      diff,
    });
  } catch {
    debugLog('Mutation notification callback failed.', { toolName });
    // UI mutation notifications should never change tool execution semantics.
  }
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  options?: ToolExecutionOptions,
): Promise<ToolExecutionResult> {
  const startedAt = Date.now();
  debugLog('Tool execution requested:', {
    toolName,
    mode: options?.mode,
  });
  const tool = getToolByName(toolName);

  if (!tool) {
    const error = `Unknown tool: ${toolName}`;
    debugLog('Tool execution blocked: unknown tool.', { toolName });
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
    debugLog('Tool execution blocked by mode:', {
      toolName,
      mode,
      target,
    });
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
    debugLog('Tool execution failed to build permission request:', { toolName });
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
  debugLog('Tool permission decision:', {
    toolName,
    scope: permissionRequest.scope,
    target: permissionRequest.target,
    outcome: permissionDecision.outcome,
    decisionScope: permissionDecision.scope,
  });
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
    const cachedDecision = getCachedPermissionDecision(cacheKey);
    let allowed = cachedDecision ?? false;
    const approvalRequest = getApprovalRequest(permissionRequest, permissionDecision.scope);
    debugLog('Tool permission requires approval:', {
      toolName,
      scope: permissionRequest.scope,
      target: permissionRequest.target,
      cached: cachedDecision !== undefined,
    });

    if (cachedDecision === undefined) {
      const preApproved = isPermissionPreApproved(approvalRequest);
      debugLog('Tool permission pre-approval check:', {
        toolName,
        target: approvalRequest.target,
        preApproved,
      });

      if (preApproved) {
        allowed = true;
      } else {
        const promptDecision = await promptForPermission(approvalRequest);
        debugLog('Tool permission prompt result:', {
          toolName,
          target: approvalRequest.target,
          promptDecision,
        });
        if (promptDecision === 'allow_session') {
          allowPermissionForSession(approvalRequest);
          allowed = true;
        } else if (promptDecision === 'allow_once') {
          allowPermissionOnce(approvalRequest);
          allowed = true;
        }
      }
    }

    setCachedPermissionDecision(cacheKey, allowed);

    if (!allowed) {
      const error =
        `Permission rejected by user for tool "${toolName}" on target "${permissionRequest.target}". ` +
        'Do not retry this action in this turn unless the user explicitly grants permission.';
      debugLog('Tool execution blocked by user permission decision:', {
        toolName,
        target: permissionRequest.target,
      });
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
    ? beginWorkspaceMutationTracking(getWorkspaceMutationRoots(toolName, args))
    : null;
  const mutationSnapshot = options?.onMutation && (mutationTargets.length > 0 || shouldTrackWorkspace)
    ? beginMutationChangeTracking(mutationTargets, workspaceMutationSnapshot)
    : null;
  debugLog('Tool execution starting:', {
    toolName,
    target: permissionRequest.target,
    mutationTargetCount: mutationTargets.length,
    tracksWorkspace: shouldTrackWorkspace,
  });

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
    debugLog('Tool execution completed:', {
      toolName,
      durationMs: Date.now() - startedAt,
      outputLength: String(result).length,
    });
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
    debugLog('Tool execution failed:', {
      toolName,
      durationMs: Date.now() - startedAt,
      error: message,
    });
    return {
      output: message,
      executedToolCall,
    };
  }
}
