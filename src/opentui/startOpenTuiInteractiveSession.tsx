/** @jsxImportSource @opentui/solid */

import { createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';
import { CliRenderEvents } from '@opentui/core';

import { isAgentMode, type AgentMode } from '../agentMode';
import { onPermissionPromptClosed, onPermissionPromptOpened } from '../permissions/promptEvents';
import { type PermissionRequest } from '../permissions/types';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from '../sessionStore';
import { runSessionTurn } from '../sessionTurnRunner';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import {
  OpenTuiInteractiveSessionApp,
  type OpenTuiSessionEntry,
} from './OpenTuiInteractiveSessionApp';

function appendEntry(
  entries: OpenTuiSessionEntry[],
  kind: OpenTuiSessionEntry['kind'],
  text: string,
): OpenTuiSessionEntry[] {
  return [...entries, { kind, text }];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatPermissionSummary(request: PermissionRequest): string {
  const target = request.target || '(no target)';
  return `${request.toolName} on ${target}`;
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
  entries: () => OpenTuiSessionEntry[];
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
  const waitForDestroy = new Promise<void>((resolve) => {
    renderer.once(CliRenderEvents.DESTROY, () => {
      resolve();
    });
  });

  const [mode, setMode] = createSignal<AgentMode>(initialMode);
  const [entries, setEntries] = createSignal<OpenTuiSessionEntry[]>([]);
  const [inputValue, setInputValue] = createSignal('');
  const [isBusy, setIsBusy] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null);

  let shouldPrintHint = false;
  let isDestroyed = false;
  let isSuspendedForPermission = false;

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

  const unsubscribePermissionOpened = onPermissionPromptOpened(({ request }) => {
    setIsBusy(true);
    setStatusMessage(`Awaiting approval for ${formatPermissionSummary(request)}...`);

    if (!isSuspendedForPermission) {
      renderer.suspend();
      isSuspendedForPermission = true;
    }
  });

  const unsubscribePermissionClosed = onPermissionPromptClosed(() => {
    if (isSuspendedForPermission) {
      renderer.resume();
      renderer.requestRender();
      isSuspendedForPermission = false;
    }

    if (isBusy()) {
      setStatusMessage('Resuming turn...');
    } else {
      setStatusMessage(null);
    }
  });

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

    renderer.start();
    await waitForDestroy;
  } finally {
    unsubscribePermissionOpened();
    unsubscribePermissionClosed();

    if (isSuspendedForPermission) {
      renderer.resume();
      isSuspendedForPermission = false;
    }

    if (!isDestroyed) {
      renderer.destroy();
    }
  }

  if (shouldPrintHint) {
    printSessionContinuationHint(sessionId);
  }
}
