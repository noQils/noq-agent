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
  saveSessionTuiEntries,
  saveSessionTuiMode,
  undoLastSessionSnapshot,
} from '../sessionStore';
import { runSessionTurn } from '../sessionTurnRunner';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import {
  applyOpenTuiTerminalBackground,
  resetOpenTuiTerminalBackground,
} from './openTuiTerminalAppearance';
import {
  OpenTuiInteractiveSessionApp,
  type OpenTuiSessionEntry,
} from './OpenTuiInteractiveSessionApp';

export interface StartOpenTuiInteractiveSessionOptions {
  restoreStoredMode?: boolean;
}

type SlashCommand =
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'exit' }
  | { type: 'diff' }
  | { type: 'undo' }
  | { type: 'plan_show' }
  | { type: 'mode'; mode: AgentMode };

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

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

function parseSlashCommand(inputLine: string): SlashCommand {
  if (inputLine === '/exit' || inputLine === '/quit') {
    return { type: 'exit' };
  }

  if (inputLine === '/diff') {
    return { type: 'diff' };
  }

  if (inputLine === '/undo') {
    return { type: 'undo' };
  }

  if (inputLine === '/plan show') {
    return { type: 'plan_show' };
  }

  if (isModeCommand(inputLine)) {
    const requestedMode = inputLine.slice('/mode'.length).trim();
    if (isAgentMode(requestedMode)) {
      return { type: 'mode', mode: requestedMode };
    }

    return { type: 'invalid' };
  }

  return inputLine.startsWith('/')
    ? { type: 'invalid' }
    : { type: 'none' };
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
  options?: StartOpenTuiInteractiveSessionOptions,
): Promise<void> {
  const initialTuiState = loadSessionTuiState(sessionId);
  const resolvedInitialMode = options?.restoreStoredMode && initialTuiState.mode
    ? initialTuiState.mode
    : initialMode;
  saveSessionTuiMode(sessionId, resolvedInitialMode);

  const renderer = await createOpenTuiRenderer();
  const waitForDestroy = new Promise<void>((resolve) => {
    renderer.once(CliRenderEvents.DESTROY, () => {
      resolve();
    });
  });

  const [mode, setMode] = createSignal<AgentMode>(resolvedInitialMode);
  const [entries, setEntries] = createSignal<OpenTuiSessionEntry[]>(initialTuiState.entries);
  const [inputValue, setInputValue] = createSignal('');
  const [isBusy, setIsBusy] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal<string | null>(null);
  const [permissionRequest, setPermissionRequest] = createSignal<PermissionRequest | null>(null);

  let shouldPrintHint = false;
  let isDestroyed = false;
  let resolvePermissionPrompt: ((decision: PermissionPromptDecision) => void) | null = null;

  const appendTranscriptEntry = (
    kind: OpenTuiSessionEntry['kind'],
    text: string,
  ): void => {
    const nextEntries = appendEntry(entries(), kind, text);
    setEntries(nextEntries);
    saveSessionTuiEntries(sessionId, nextEntries);
  };

  const setActiveMode = (nextMode: AgentMode): void => {
    setMode(nextMode);
    saveSessionTuiMode(sessionId, nextMode);
  };

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

  const handleSlashCommand = (command: SlashCommand): boolean => {
    switch (command.type) {
      case 'none':
        return false;

      case 'invalid':
        return true;

      case 'exit':
        exitSession();
        return true;

      case 'diff':
        try {
          const result = getLatestSessionDiff(sessionId);
          appendTranscriptEntry('system', result);
        } catch (error) {
          appendTranscriptEntry('system', `Command failed: ${formatErrorMessage(error)}`);
        }
        return true;

      case 'undo':
        try {
          const result = undoLastSessionSnapshot(sessionId);
          appendTranscriptEntry('system', result);
        } catch (error) {
          appendTranscriptEntry('system', `Command failed: ${formatErrorMessage(error)}`);
        }
        return true;

      case 'plan_show':
        try {
          const result = formatLatestSessionPlan(sessionId);
          appendTranscriptEntry('system', result);
        } catch (error) {
          appendTranscriptEntry('system', `Command failed: ${formatErrorMessage(error)}`);
        }
        return true;

      case 'mode':
        setActiveMode(command.mode);
        appendTranscriptEntry('system', printModeChange(command.mode));
        return true;
    }
  };

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

    if (userInput.length === 0) {
      setInputValue('');
      return;
    }

    const slashCommand = parseSlashCommand(userInput);
    if (slashCommand.type === 'invalid') {
      return;
    }

    setInputValue('');
    setStatusMessage(null);

    if (handleSlashCommand(slashCommand)) {
      return;
    }

    appendTranscriptEntry('user', rawInput);

    setIsBusy(true);
    setStatusMessage('Running turn...');

    try {
      const { response } = await runSessionTurn(sessionId, rawInput, mode(), {
        onMutation: (event) => {
          appendTranscriptEntry('system', event.diff);
          renderer.requestRender();
        },
      });
      appendTranscriptEntry('assistant', response);
      setStatusMessage('Turn completed');
    } catch (error) {
      appendTranscriptEntry('system', `Turn failed: ${formatErrorMessage(error)}`);
      setStatusMessage('Turn failed');
    } finally {
      setIsBusy(false);
    }
  };

  try {
    applyOpenTuiTerminalBackground();

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

    resetOpenTuiTerminalBackground();
  }

  if (shouldPrintHint) {
    printSessionContinuationHint(sessionId);
  }
}
