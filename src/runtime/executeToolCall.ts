import { evaluatePermission } from '../permissions/evaluate';
import { promptForPermission } from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
import { canonicalizeArgsValue } from '../providers/shared/toolFingerprint';
import { getToolByName } from '../tools';
import { type ExecutedToolCall } from '../providers/types';

export interface ToolExecutionResult {
  output: string;
  executedToolCall: ExecutedToolCall;
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

  return {
    scope: tool.permission.scope,
    toolName: tool.name,
    target: tool.permission.getTarget(args),
    args,
  };
}

export function resetPermissionDecisionCache(): void {
  permissionDecisionCache.clear();
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
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
    const allowed = cachedDecision ?? await promptForPermission(permissionRequest);

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

  try {
    const result = await tool.execute(args);
    return {
      output: String(result),
      executedToolCall: {
        toolName,
        args,
        succeeded: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: message,
      executedToolCall: {
        toolName,
        args,
        succeeded: false,
        error: message,
        failureKind: 'tool_error',
      },
    };
  }
}
