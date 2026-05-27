import React from 'react';
import { render } from 'ink';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from './sessionStore';
import { runSessionTurn } from './sessionTurnRunner';
import { InteractiveSessionApp } from './tui/InteractiveSessionApp';
import { type SessionEntry, type SessionEntryKind } from './tui/state';

type ScreenInputResult =
  | { kind: 'submit'; line: string }
  | { kind: 'exit' };

function printSessionContinuationHint(sessionId: string): void {
  console.log(`To continue this conversation use: noq --session ${sessionId}`);
}

function printModeChange(mode: AgentMode): string {
  return `Switched to ${mode} mode.`;
}

function printModeCommandError(): string {
  return 'Usage: /mode plan or /mode build';
}

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

function readTuiInput(
  sessionId: string,
  mode: AgentMode,
  entries: SessionEntry[],
): Promise<ScreenInputResult> {
  return new Promise((resolve) => {
    const app = render(
      React.createElement(InteractiveSessionApp, {
        sessionId,
        mode,
        entries,
        onFinish: (result: ScreenInputResult) => {
          resolve(result);
        },
      }),
      {
        stdin: input,
        stdout: output,
        exitOnCtrlC: false,
      },
    );

    void app.waitUntilExit();
  });
}

function appendEntry(entries: SessionEntry[], kind: SessionEntryKind, text: string): void {
  entries.push({
    kind,
    text,
  });
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function appendCommandResult(
  entries: SessionEntry[],
  command: () => Promise<string> | string,
): Promise<void> {
  try {
    const result = await command();
    appendEntry(entries, 'system', result);
  } catch (error) {
    appendEntry(entries, 'system', `Command failed: ${formatErrorMessage(error)}`);
  }
}

export async function startInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  let mode = initialMode;
  const entries: SessionEntry[] = [];

  while (true) {
    const promptResult = await readTuiInput(sessionId, mode, entries);

    if (promptResult.kind === 'exit') {
      console.log('');
      printSessionContinuationHint(sessionId);
      return;
    }

    const rawInput = promptResult.line;
    const userInput = rawInput.trim();
    if (userInput.length === 0) {
      continue;
    }

    appendEntry(entries, 'user', rawInput);

    if (userInput === '/exit' || userInput === '/quit') {
      printSessionContinuationHint(sessionId);
      return;
    }

    if (userInput === '/diff') {
      await appendCommandResult(entries, () => getLatestSessionDiff(sessionId));
      continue;
    }

    if (userInput === '/undo') {
      await appendCommandResult(entries, () => undoLastSessionSnapshot(sessionId));
      continue;
    }

    if (userInput === '/plan show') {
      await appendCommandResult(entries, () => formatLatestSessionPlan(sessionId));
      continue;
    }

    if (isModeCommand(userInput)) {
      const requestedMode = userInput.slice('/mode'.length).trim();
      if (!isAgentMode(requestedMode)) {
        appendEntry(entries, 'system', printModeCommandError());
        continue;
      }

      mode = requestedMode;
      appendEntry(entries, 'system', printModeChange(mode));
      continue;
    }

    try {
      const { response } = await runSessionTurn(sessionId, rawInput, mode);
      appendEntry(entries, 'assistant', response);
    } catch (error) {
      appendEntry(entries, 'system', `Turn failed: ${formatErrorMessage(error)}`);
    }
  }
}
