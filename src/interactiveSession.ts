import React from 'react';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { onPermissionPromptClosed, onPermissionPromptOpened } from './permissions/promptEvents';
import { type PermissionRequest } from './permissions/types';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from './sessionStore';
import { runSessionTurn } from './sessionTurnRunner';
import { InteractiveSessionApp } from './tui/InteractiveSessionApp';
import { createFullscreenRenderer, type FullscreenRendererHandle } from './tui/fullscreenRenderer';
import {
  type InteractiveSessionViewModel,
  type SessionEntry,
  type SessionEntryKind,
} from './tui/state';

interface InteractiveSessionState {
  mode: AgentMode;
  entries: SessionEntry[];
  inputValue: string;
  isBusy: boolean;
  isWaitingForPermission: boolean;
  permissionSummary: string | null;
}

type PendingAction =
  | { kind: 'submit' }
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

function appendEntry(entries: SessionEntry[], kind: SessionEntryKind, text: string): SessionEntry[] {
  return [
    ...entries,
    {
      kind,
      text,
    },
  ];
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createInitialState(mode: AgentMode): InteractiveSessionState {
  return {
    mode,
    entries: [],
    inputValue: '',
    isBusy: false,
    isWaitingForPermission: false,
    permissionSummary: null,
  };
}

function formatPermissionSummary(request: PermissionRequest): string {
  const target = request.target || '(no target)';
  return `${request.toolName} on ${target}`;
}

function buildViewModel(sessionId: string, state: InteractiveSessionState): InteractiveSessionViewModel {
  const inputTone = state.isWaitingForPermission
    ? 'permission'
    : state.isBusy
      ? 'busy'
      : 'idle';

  const inputLabel = state.isWaitingForPermission
    ? 'Permission'
    : state.isBusy
      ? 'Working'
      : 'Message';

  const inputText = state.isWaitingForPermission
    ? `Awaiting approval for ${state.permissionSummary ?? 'the current action'}...`
    : state.isBusy
      ? 'Waiting for the current turn to finish...'
      : `> ${state.inputValue}`;

  return {
    statusText: `Session: ${sessionId} | Mode: ${state.mode}`,
    helpText: '/mode plan | /mode build | /plan show | /diff | /undo | /exit',
    entries: state.entries,
    inputLabel,
    inputText,
    inputTone,
    emptyStateText: 'Conversation started. Type a message or use /exit to leave the session.',
  };
}

function renderInteractiveSessionApp(
  renderer: FullscreenRendererHandle,
  sessionId: string,
  state: InteractiveSessionState,
  onInputValueChange: (value: string) => void,
  onSubmit: () => void,
  onExit: () => void,
): void {
  renderer.rerender(
    React.createElement(InteractiveSessionApp, {
      viewModel: buildViewModel(sessionId, state),
      inputValue: state.inputValue,
      isBusy: state.isBusy,
      onInputValueChange,
      onSubmit,
      onExit,
    }),
  );
}

export async function startInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  let state = createInitialState(initialMode);
  let pendingActionResolver: ((action: PendingAction) => void) | null = null;
  let inkRenderer: FullscreenRendererHandle | null = null;

  const mountInkApp = (): void => {
    if (inkRenderer) {
      return;
    }

    inkRenderer = createFullscreenRenderer(React.createElement(React.Fragment));
  };

  const unmountInkApp = (): void => {
    if (!inkRenderer) {
      return;
    }

    inkRenderer.unmount();
    inkRenderer = null;
  };

  const syncInkApp = (): void => {
    if (!inkRenderer) {
      return;
    }

    renderInteractiveSessionApp(
      inkRenderer,
      sessionId,
      state,
      (value) => {
        setState({
          ...state,
          inputValue: value,
        });
      },
      () => {
        pendingActionResolver?.({ kind: 'submit' });
      },
      () => {
        pendingActionResolver?.({ kind: 'exit' });
      },
    );
  };

  const setState = (nextState: InteractiveSessionState): void => {
    state = nextState;
    syncInkApp();
  };

  mountInkApp();
  syncInkApp();

  const unsubscribePermissionOpened = onPermissionPromptOpened(({ request }) => {
    setState({
      ...state,
      isBusy: true,
      isWaitingForPermission: true,
      permissionSummary: formatPermissionSummary(request),
    });
    unmountInkApp();
  });

  const unsubscribePermissionClosed = onPermissionPromptClosed(() => {
    state = {
      ...state,
      isWaitingForPermission: false,
      permissionSummary: null,
    };
    mountInkApp();
    syncInkApp();
  });

  try {
    while (true) {
      const action = await new Promise<PendingAction>((resolve) => {
        pendingActionResolver = resolve;
      });
      pendingActionResolver = null;

      if (action.kind === 'exit') {
        unmountInkApp();
        console.log('');
        printSessionContinuationHint(sessionId);
        return;
      }

      const rawInput = state.inputValue;
      const userInput = rawInput.trim();
      if (userInput.length === 0) {
        setState({
          ...state,
          inputValue: '',
        });
        continue;
      }

      setState({
        ...state,
        entries: appendEntry(state.entries, 'user', rawInput),
        inputValue: '',
      });

      if (userInput === '/exit' || userInput === '/quit') {
        unmountInkApp();
        printSessionContinuationHint(sessionId);
        return;
      }

      if (userInput === '/diff') {
        try {
          const result = getLatestSessionDiff(sessionId);
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', result),
          });
        } catch (error) {
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', `Command failed: ${formatErrorMessage(error)}`),
          });
        }
        continue;
      }

      if (userInput === '/undo') {
        try {
          const result = undoLastSessionSnapshot(sessionId);
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', result),
          });
        } catch (error) {
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', `Command failed: ${formatErrorMessage(error)}`),
          });
        }
        continue;
      }

      if (userInput === '/plan show') {
        try {
          const result = formatLatestSessionPlan(sessionId);
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', result),
          });
        } catch (error) {
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', `Command failed: ${formatErrorMessage(error)}`),
          });
        }
        continue;
      }

      if (isModeCommand(userInput)) {
        const requestedMode = userInput.slice('/mode'.length).trim();
        if (!isAgentMode(requestedMode)) {
          setState({
            ...state,
            entries: appendEntry(state.entries, 'system', printModeCommandError()),
          });
          continue;
        }

        setState({
          ...state,
          mode: requestedMode,
          entries: appendEntry(state.entries, 'system', printModeChange(requestedMode)),
        });
        continue;
      }

      setState({
        ...state,
        isBusy: true,
      });

      try {
        const { response } = await runSessionTurn(sessionId, rawInput, state.mode);
        setState({
          ...state,
          isBusy: false,
          isWaitingForPermission: false,
          permissionSummary: null,
          entries: appendEntry(state.entries, 'assistant', response),
        });
      } catch (error) {
        setState({
          ...state,
          isBusy: false,
          isWaitingForPermission: false,
          permissionSummary: null,
          entries: appendEntry(state.entries, 'system', `Turn failed: ${formatErrorMessage(error)}`),
        });
      }
    }
  } finally {
    unsubscribePermissionOpened();
    unsubscribePermissionClosed();
    unmountInkApp();
  }
}
