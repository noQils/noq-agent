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
  loadOrCreateSession,
  saveSessionPlanArtifact,
} from './sessionStore';
import { runAgentTurn } from './workflow';

export interface SessionTurnResult {
  sessionId: string;
  response: string;
  fileChanges: SessionFileChange[];
}

export async function runSessionTurn(
  sessionId: string,
  userPrompt: string,
  mode: AgentMode,
): Promise<SessionTurnResult> {
  const session = loadOrCreateSession(sessionId);
  const historyMessages = buildSessionHistoryMessages(session);

  beginSessionChangeTracking();
  let response: string;

  try {
    response = await runAgentTurn(userPrompt, mode, { historyMessages });
  } catch (error) {
    resetSessionChangeTracking();
    throw error;
  }

  const fileChanges = finishSessionChangeTracking();
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
}
