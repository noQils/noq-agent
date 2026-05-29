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
import { type ToolMutationCallback } from './providers/types';
import { debugLog, getDebugLogFilePath, setDebugLogFilePath } from './runtimeSettings';
import { runAgentTurn } from './workflow';

export interface SessionTurnResult {
  sessionId: string;
  response: string;
  fileChanges: SessionFileChange[];
}

export interface SessionTurnOptions {
  onMutation?: ToolMutationCallback;
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
    const historyMessages = buildSessionHistoryMessages(session);
    debugLog('Session turn start:', {
      sessionId,
      mode,
      turnCount: session.turns.length,
      historyMessageCount: historyMessages.length,
      promptLength: userPrompt.length,
    });

    beginSessionChangeTracking();
    let response: string;

    try {
      response = await runAgentTurn(userPrompt, mode, {
        historyMessages,
        ...(options?.onMutation ? { onMutation: options.onMutation } : {}),
      });
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
      responseLength: response.length,
      fileChangeCount: fileChanges.length,
    });
    appendSessionTurn(
      sessionId,
      {
        timestamp: new Date().toISOString(),
        mode,
        userPrompt,
        response,
      },
      fileChanges,
    );

    if (mode === 'plan') {
      saveSessionPlanArtifact(sessionId, {
        userPrompt,
        response,
      });
    }

    return {
      sessionId,
      response,
      fileChanges,
    };
  } finally {
    setDebugLogFilePath(previousDebugLogFilePath);
  }
}
