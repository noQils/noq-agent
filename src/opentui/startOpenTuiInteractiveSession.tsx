/** @jsxImportSource @opentui/solid */

import { createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';

import { isAgentMode, type AgentMode } from '../agentMode';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from '../sessionStore';
import { runSessionTurn } from '../sessionTurnRunner';
import { type SessionEntry } from '../tui/state';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import { OpenTuiInteractiveSessionApp } from './OpenTuiInteractiveSessionApp';

function appendEntry(entries: SessionEntry[], kind: SessionEntry['kind'], text: string): SessionEntry[] {
  return [...entries, { kind, text }];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function SessionRoot(props: {
  sessionId: string;
  mode: () => AgentMode;
  entries: () => SessionEntry[];
  inputValue: () => string;
  isBusy: () => boolean;
  statusMessage: () => string | null;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}) {
  useRenderer();

  return (
    <OpenTuiInteractiveSessionApp
      sessionId={props.sessionId}
      mode={props.mode}
      entries={props.entries}
      inputValue={props.inputValue}
      isBusy={props.isBusy}
      statusMessage={props.statusMessage}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
      onExit={props.onExit}
    />
  );
}

export async function startOpenTuiInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
): Promise<void> {
  const renderer = await createOpenTuiRenderer();

  const [mode, setMode] = createSignal<AgentMode>(initialMode);
  const [entries, setEntries] = createSignal<SessionEntry[]>([]);
  const [inputValue, setInputValue] = createSignal('');
  const [isBusy, setIsBusy] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null);

  let shouldPrintHint = false;
  let isDestroyed = false;

  const exitSession = (): void => {
    shouldPrintHint = true;
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    renderer.destroy();
  };

  const handleSubmit = async (): Promise<void> => {
    if (isBusy()) {
      return;
    }

    const rawInput = inputValue();
    const userInput = rawInput.trim();
    setInputValue('');

    if (userInput.length === 0) {
      return;
    }

    setEntries((currentEntries) => appendEntry(currentEntries, 'user', rawInput));
    setStatusMessage(null);

    if (userInput === '/exit' || userInput === '/quit') {
      exitSession();
      return;
    }

    if (userInput === '/diff') {
      try {
        const result = getLatestSessionDiff(sessionId);
        setEntries((currentEntries) => appendEntry(currentEntries, 'system', result));
      } catch (error) {
        setEntries((currentEntries) => (
          appendEntry(currentEntries, 'system', `Command failed: ${formatErrorMessage(error)}`)
        ));
      }
      return;
    }

    if (userInput === '/undo') {
      try {
        const result = undoLastSessionSnapshot(sessionId);
        setEntries((currentEntries) => appendEntry(currentEntries, 'system', result));
      } catch (error) {
        setEntries((currentEntries) => (
          appendEntry(currentEntries, 'system', `Command failed: ${formatErrorMessage(error)}`)
        ));
      }
      return;
    }

    if (userInput === '/plan show') {
      try {
        const result = formatLatestSessionPlan(sessionId);
        setEntries((currentEntries) => appendEntry(currentEntries, 'system', result));
      } catch (error) {
        setEntries((currentEntries) => (
          appendEntry(currentEntries, 'system', `Command failed: ${formatErrorMessage(error)}`)
        ));
      }
      return;
    }

    if (isModeCommand(userInput)) {
      const requestedMode = userInput.slice('/mode'.length).trim();
      if (!isAgentMode(requestedMode)) {
        setEntries((currentEntries) => appendEntry(currentEntries, 'system', printModeCommandError()));
        return;
      }

      setMode(requestedMode);
      setEntries((currentEntries) => appendEntry(currentEntries, 'system', printModeChange(requestedMode)));
      return;
    }

    setIsBusy(true);
    setStatusMessage('Running turn...');

    try {
      const { response } = await runSessionTurn(sessionId, rawInput, mode());
      setEntries((currentEntries) => appendEntry(currentEntries, 'assistant', response));
      setStatusMessage('Turn completed');
    } catch (error) {
      setEntries((currentEntries) => (
        appendEntry(currentEntries, 'system', `Turn failed: ${formatErrorMessage(error)}`)
      ));
      setStatusMessage('Turn failed');
    } finally {
      setIsBusy(false);
    }
  };

  try {
    await render(
      () => (
        <SessionRoot
          sessionId={sessionId}
          mode={mode}
          entries={entries}
          inputValue={inputValue}
          isBusy={isBusy}
          statusMessage={statusMessage}
          onInput={setInputValue}
          onSubmit={() => {
            void handleSubmit();
          }}
          onExit={exitSession}
        />
      ),
      renderer,
    );
  } finally {
    if (!isDestroyed) {
      renderer.destroy();
    }
  }

  if (shouldPrintHint) {
    printSessionContinuationHint(sessionId);
  }
}
