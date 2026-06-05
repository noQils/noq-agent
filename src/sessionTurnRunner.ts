import { type AgentMode } from './agentMode';
import {
  beginSessionChangeTracking,
  finishSessionChangeTracking,
  resetSessionChangeTracking,
  type SessionFileChange,
} from './sessionChangeTracker';
import {
  appendSessionTurn,
  buildSessionHistoryMessages,
  getSessionDebugLogPath,
  loadOrCreateSession,
  saveSessionPlanArtifact,
} from './sessionStore';
import { type Provider, type ToolMutationCallback } from './providers/types';
import { debugLog, getDebugLogFilePath, setDebugLogFilePath } from './runtimeSettings';
import { runAgentTurn } from './workflow';

export interface SessionTurnResult {
  sessionId: string;
  response: string;
  fileChanges: SessionFileChange[];
}

export interface SessionTurnOptions {
  onMutation?: ToolMutationCallback;
  workingDirectory?: string;
  provider?: Provider;
}

async function withWorkingDirectory<T>(workspaceRoot: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(workspaceRoot);

  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}

export async function runSessionTurn(
  sessionId: string,
  userPrompt: string,
  mode: AgentMode,
  options?: SessionTurnOptions,
): Promise<SessionTurnResult> {
  const previousDebugLogFilePath = getDebugLogFilePath();
  setDebugLogFilePath(getSessionDebugLogPath(sessionId));

  try {
    const session = loadOrCreateSession(sessionId);
    const effectiveWorkingDirectory = options?.workingDirectory ?? session.workspaceRoot;
    const historyMessages = buildSessionHistoryMessages(session);
    debugLog('Session turn start:', {
      sessionId,
      mode,
      turnCount: session.turns.length,
      historyMessageCount: historyMessages.length,
      promptLength: userPrompt.length,
      workingDirectory: effectiveWorkingDirectory,
    });

    beginSessionChangeTracking();
    let turnResult: Awaited<ReturnType<typeof runAgentTurn>>;

    try {
      turnResult = await withWorkingDirectory(effectiveWorkingDirectory, () => runAgentTurn(userPrompt, mode, {
        historyMessages,
        ...(options?.onMutation ? { onMutation: options.onMutation } : {}),
        ...(options?.provider ? { provider: options.provider } : {}),
      }));
    } catch (error) {
      resetSessionChangeTracking();
      debugLog('Session turn failed:', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const fileChanges = finishSessionChangeTracking();
    debugLog('Session turn completed:', {
      sessionId,
      mode,
      responseLength: turnResult.response.length,
      fileChangeCount: fileChanges.length,
    });
    appendSessionTurn(
      sessionId,
      {
        timestamp: new Date().toISOString(),
        mode,
        userPrompt,
        response: turnResult.response,
        workingDirectory: effectiveWorkingDirectory,
        stopReason: turnResult.stopReason,
        executedToolCalls: turnResult.executedToolCalls,
      },
      fileChanges,
    );

    if (mode === 'plan') {
      saveSessionPlanArtifact(sessionId, {
        userPrompt,
        response: turnResult.response,
      });
    }

    return {
      sessionId,
      response: turnResult.response,
      fileChanges,
    };
  } finally {
    setDebugLogFilePath(previousDebugLogFilePath);
  }
}
