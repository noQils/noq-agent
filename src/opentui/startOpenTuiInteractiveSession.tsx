/** @jsxImportSource @opentui/solid */

import { createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';
import { CliRenderEvents } from '@opentui/core';

import { isAgentMode, type AgentMode } from '../agentMode';
import { resetPermissionApprovalState, setPermissionApprovalSession } from '../permissions/approvals';
import {
  resetPermissionPromptHandler,
  setPermissionPromptHandler,
  type PermissionPromptDecision,
} from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
import {
  formatLatestSessionPlan,
  getLatestSessionDiff,
  loadSessionTuiState,
  undoLastSessionSnapshot,
} from '../sessionStore';
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
  return [
    ...entries,
    {
      id: `entry-${Date.now()}-${entries.length + 1}`,
      createdAt: new Date().toISOString(),
      kind,
      text,
    },
  ];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatPermissionSummary(request: PermissionRequest): string {
  const target = request.target || '(no target)';
  return `${request.toolName} on ${target}`;
}

function printSessionContinuationHint(sessionId: string): void {
  console.log(
`
███╗   ██╗ ██████╗  ██████╗
████╗  ██║██╔═══██╗██╔═══██╗
██╔██╗ ██║██║   ██║██║   ██║
██║╚██╗██║██║   ██║██║   ██║
██║ ╚████║╚██████╔╝╚██████╔╝
╚═╝  ╚═══╝ ╚═════╝  ╚══▀█▄╗
                        ╚═╝
`
  );
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

function parsePermissionDecision(inputLine: string): PermissionPromptDecision | null {
  const normalizedInput = inputLine.trim().toLowerCase();

  if (normalizedInput === 'o' || normalizedInput === 'y') {
    return 'allow_once';
  }

  if (normalizedInput === 'a') {
    return 'allow_session';
  }

  if (normalizedInput === 'n') {
    return 'deny';
  }

  return null;
}

function SessionRoot(props: {
  sessionId: string;
  mode: () => AgentMode;
  entries: () => OpenTuiSessionEntry[];
  inputValue: () => string;
  isBusy: () => boolean;
  statusMessage: () => string | null;
  permissionRequest: () => PermissionRequest | null;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
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
      permissionRequest={props.permissionRequest}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
      onExit={props.onExit}
      onPermissionDecision={props.onPermissionDecision}
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

  const initialTuiState = loadSessionTuiState(sessionId);
  const [mode, setMode] = createSignal<AgentMode>(initialMode);
  const [entries, setEntries] = createSignal<OpenTuiSessionEntry[]>(initialTuiState.entries);
  const [inputValue, setInputValue] = createSignal('');
  const [isBusy, setIsBusy] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null);
  const [permissionRequest, setPermissionRequest] = createSignal<PermissionRequest | null>(null);

  let shouldPrintHint = false;
  let isDestroyed = false;
  let resolvePermissionPrompt: ((decision: PermissionPromptDecision) => void) | null = null;

  const resolveActivePermissionPrompt = (
    decision: PermissionPromptDecision,
    shouldRequestRender = true,
  ): void => {
    const resolver = resolvePermissionPrompt;
    resolvePermissionPrompt = null;
    setPermissionRequest(null);

    if (isBusy()) {
      setStatusMessage('Resuming turn...');
    }

    if (resolver) {
      resolver(decision);
    }

    if (shouldRequestRender) {
      renderer.requestRender();
    }
  };

  const exitSession = (): void => {
    shouldPrintHint = true;
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    renderer.destroy();
  };

  resetPermissionApprovalState();
  setPermissionApprovalSession(sessionId);
  setPermissionPromptHandler((request) => {
    if (resolvePermissionPrompt) {
      resolveActivePermissionPrompt('deny', false);
    }

    setIsBusy(true);
    setPermissionRequest(request);
    setStatusMessage(`Awaiting approval...`);
    renderer.requestRender();

    return new Promise<PermissionPromptDecision>((resolve) => {
      resolvePermissionPrompt = resolve;
    });
  });

  const handleSubmit = async (): Promise<void> => {
    const rawInput = inputValue();
    const userInput = rawInput.trim();

    if (permissionRequest()) {
      const decision = parsePermissionDecision(userInput);

      if (!decision) {
        if (userInput.length > 0) {
          setInputValue('');
          setStatusMessage('Type o/y, a, or n and press Enter.');
          renderer.requestRender();
        }

        return;
      }

      setInputValue('');
      resolveActivePermissionPrompt(decision);
      return;
    }

    if (isBusy()) {
      return;
    }

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
      const { response } = await runSessionTurn(sessionId, rawInput, mode(), {
        onMutation: (event) => {
          setEntries((currentEntries) => appendEntry(currentEntries, 'system', event.diff));
          renderer.requestRender();
        },
      });
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
          permissionRequest={permissionRequest}
          onInput={setInputValue}
          onSubmit={() => {
            void handleSubmit();
          }}
          onExit={exitSession}
          onPermissionDecision={resolveActivePermissionPrompt}
        />
      ),
      renderer,
    );

    renderer.start();
    await waitForDestroy;
  } finally {
    if (resolvePermissionPrompt) {
      resolveActivePermissionPrompt('deny', false);
    }

    resetPermissionPromptHandler();
    resetPermissionApprovalState();

    if (!isDestroyed) {
      renderer.destroy();
    }
  }

  if (shouldPrintHint) {
    printSessionContinuationHint(sessionId);
  }
}
