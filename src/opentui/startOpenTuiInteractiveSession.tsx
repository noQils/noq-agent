/** @jsxImportSource @opentui/solid */

import { createEffect, createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';
import { CliRenderEvents } from '@opentui/core';

import { type AgentMode } from '../agentMode';
import { resetPermissionApprovalState, setPermissionApprovalSession } from '../permissions/approvals';
import {
  resetPermissionPromptHandler,
  setPermissionPromptHandler,
  type PermissionPromptDecision,
} from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
import {
  formatLatestSessionPlan,
  generateUniqueSessionId,
  getLatestSessionDiff,
  getSessionDebugLogPath,
  loadSessionTuiState,
  saveSessionTuiEntries,
  saveSessionTuiMode,
  setSessionPermissionOverride,
  undoLastSessionSnapshot,
} from '../session/sessionStore';
import { runSessionTurn } from '../session/sessionTurnRunner';
import {
  connectProviderChoices,
  getModelProviderChoices,
} from '../setupCommands';
import { setDebugLogFilePath } from '../config/runtimeSettings';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import {
  applyOpenTuiTerminalBackground,
  resetOpenTuiTerminalBackground,
} from './openTuiTerminalAppearance';
import {
  OpenTuiInteractiveSessionApp,
} from './OpenTuiInteractiveSessionApp';
import {
  getNextPermissionOutcome,
  getPermissionsEditorItems,
} from './permissionsEditorState';
import { parseSlashCommand, type SlashCommand } from './slashCommands';
import {
  type OpenTuiModelsSetupState,
  type OpenTuiPermissionItem,
  type OpenTuiProviderSetupState,
  type OpenTuiSessionEntry,
  type OpenTuiSetupModalKind,
} from './openTuiTypes';

export interface StartOpenTuiInteractiveSessionOptions {
  restoreStoredMode?: boolean;
  cwd?: string;
}

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

function formatDraftCommandMessage(commandLabel: string): string {
  return `No session history exists yet. Send a prompt first, then ${commandLabel} will be available.`;
}

function printModeChange(mode: AgentMode): string {
  return `Switched to ${mode} mode.`;
}

function parsePermissionDecision(inputLine: string): PermissionPromptDecision | null {
  const normalizedInput = inputLine.trim().toLowerCase();

  if (normalizedInput === 'o') {
    return 'allow_once';
  }

  if (normalizedInput === 's') {
    return 'allow_session';
  }

  if (normalizedInput === 'd') {
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
  permissionsEditorOpen: () => boolean;
  activeSetupModal: () => OpenTuiSetupModalKind | null;
  providerSetupState: () => OpenTuiProviderSetupState;
  modelsSetupState: () => OpenTuiModelsSetupState;
  permissionItems: () => OpenTuiPermissionItem[];
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
  onClosePermissionsEditor: () => void;
  onCloseSetupModal: () => void;
  onCyclePermissionItem: (index: number) => void;
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
      permissionsEditorOpen={props.permissionsEditorOpen}
      activeSetupModal={props.activeSetupModal}
      providerSetupState={props.providerSetupState}
      modelsSetupState={props.modelsSetupState}
      permissionItems={props.permissionItems}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
      onExit={props.onExit}
      onPermissionDecision={props.onPermissionDecision}
      onClosePermissionsEditor={props.onClosePermissionsEditor}
      onCloseSetupModal={props.onCloseSetupModal}
      onCyclePermissionItem={props.onCyclePermissionItem}
    />
  );
}

export async function startOpenTuiInteractiveSession(
  sessionId: string | undefined,
  initialMode: AgentMode,
  options?: StartOpenTuiInteractiveSessionOptions,
): Promise<void> {
  const sessionWorkingDirectory = options?.cwd ?? process.cwd();

  if (sessionId) {
    setDebugLogFilePath(getSessionDebugLogPath(sessionId));
  }

  const initialTuiState = sessionId
    ? loadSessionTuiState(sessionId)
    : { mode: null, entries: [] };
  const resolvedInitialMode = options?.restoreStoredMode && initialTuiState.mode
    ? initialTuiState.mode
    : initialMode;
  if (sessionId) {
    saveSessionTuiMode(sessionId, resolvedInitialMode);
  }

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
  const [permissionsEditorOpen, setPermissionsEditorOpen] = createSignal(false);
  const [activeSetupModal, setActiveSetupModal] = createSignal<OpenTuiSetupModalKind | null>(null);
  const [providerSetupState, setProviderSetupState] = createSignal<OpenTuiProviderSetupState>({
    query: '',
    selectedIndex: 0,
    step: 'list',
    activeProvider: null,
    apiKeyInput: '',
  });
  const [modelsSetupState, setModelsSetupState] = createSignal<OpenTuiModelsSetupState>({
    query: '',
    selectedIndex: 0,
    activeProvider: null,
    customModelInput: '',
    isLoading: false,
  });
  const [permissionItems, setPermissionItems] = createSignal<OpenTuiPermissionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(sessionId ?? null);

  let shouldPrintHint = false;
  let isDestroyed = false;
  let resolvePermissionPrompt: ((decision: PermissionPromptDecision) => void) | null = null;

  const appendTranscriptEntry = (
    kind: OpenTuiSessionEntry['kind'],
    text: string,
  ): void => {
    const nextEntries = appendEntry(entries(), kind, text);
    setEntries(nextEntries);
    const resolvedSessionId = activeSessionId();
    if (resolvedSessionId) {
      saveSessionTuiEntries(resolvedSessionId, nextEntries);
    }
  };

  const setActiveMode = (nextMode: AgentMode): void => {
    setMode(nextMode);
    const resolvedSessionId = activeSessionId();
    if (resolvedSessionId) {
      saveSessionTuiMode(resolvedSessionId, nextMode);
    }
  };

  const ensureActiveSessionId = (): string => {
    const existingSessionId = activeSessionId();
    if (existingSessionId) {
      return existingSessionId;
    }

    const nextSessionId = generateUniqueSessionId();
    setActiveSessionId(nextSessionId);
    setDebugLogFilePath(getSessionDebugLogPath(nextSessionId));
    setPermissionApprovalSession(nextSessionId);
    saveSessionTuiMode(nextSessionId, mode());

    return nextSessionId;
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

  const refreshPermissionItems = (sessionIdOverride?: string | null): void => {
    setPermissionItems(getPermissionsEditorItems(sessionIdOverride ?? activeSessionId()));
  };

  createEffect(() => {
    refreshPermissionItems(activeSessionId());
  });

  const closePermissionsEditor = (): void => {
    setPermissionsEditorOpen(false);
    if (!isBusy()) {
      setStatusMessage('Ready');
    }
    renderer.requestRender();
  };

  const closeSetupModal = (): void => {
    setActiveSetupModal(null);
    setProviderSetupState({
      query: '',
      selectedIndex: 0,
      step: 'list',
      activeProvider: null,
      apiKeyInput: '',
    });
    setModelsSetupState({
      query: '',
      selectedIndex: 0,
      activeProvider: null,
      customModelInput: '',
      isLoading: false,
    });
    if (!isBusy()) {
      setStatusMessage('Ready');
    }
    renderer.requestRender();
  };

  const cycleSelectedPermissionItem = (selectedIndex: number): void => {
    const items = permissionItems();
    const targetItem = items[selectedIndex];
    if (!targetItem) {
      return;
    }

    const resolvedSessionId = ensureActiveSessionId();
    const nextOutcome = getNextPermissionOutcome(targetItem.outcome);
    setPermissionItems(items.map((item, index) => {
      if (index !== selectedIndex) {
        return item;
      }

      return {
        ...item,
        outcome: nextOutcome,
      };
    }));
    setSessionPermissionOverride(resolvedSessionId, targetItem.scope, nextOutcome);
    refreshPermissionItems(resolvedSessionId);
    renderer.requestRender();
  };

  const exitSession = (): void => {
    shouldPrintHint = activeSessionId() !== null;
    if (isDestroyed) {
      return;
    }

    isDestroyed = true;
    renderer.destroy();
  };

  resetPermissionApprovalState();
  setPermissionApprovalSession(activeSessionId() ?? undefined);
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
        appendTranscriptEntry('system', 'Unknown command.');
        return true;

      case 'connect':
        setProviderSetupState({
          query: '',
          selectedIndex: 0,
          step: 'list',
          activeProvider: connectProviderChoices[0] ?? null,
          apiKeyInput: '',
        });
        setActiveSetupModal('providers');
        setStatusMessage('Connect provider');
        return true;

      case 'models': {
        const providers = getModelProviderChoices();
        setModelsSetupState({
          query: '',
          selectedIndex: 0,
          activeProvider: providers[0] ?? null,
          customModelInput: '',
          isLoading: false,
        });
        setActiveSetupModal('models');
        setStatusMessage('Choose model');
        return true;
      }

      case 'permissions':
        refreshPermissionItems();
        setPermissionsEditorOpen(true);
        setStatusMessage('Permissions editor');
        return true;

      case 'exit':
        exitSession();
        return true;

      case 'diff':
        if (!activeSessionId()) {
          appendTranscriptEntry('system', formatDraftCommandMessage('/diff'));
          return true;
        }
        try {
          const result = getLatestSessionDiff(activeSessionId()!);
          appendTranscriptEntry('system', result);
        } catch (error) {
          appendTranscriptEntry('system', `Command failed: ${formatErrorMessage(error)}`);
        }
        return true;

      case 'undo':
        if (!activeSessionId()) {
          appendTranscriptEntry('system', formatDraftCommandMessage('/undo'));
          return true;
        }
        try {
          const result = undoLastSessionSnapshot(activeSessionId()!);
          appendTranscriptEntry('system', result);
        } catch (error) {
          appendTranscriptEntry('system', `Command failed: ${formatErrorMessage(error)}`);
        }
        return true;

      case 'plan_show':
        if (!activeSessionId()) {
          appendTranscriptEntry('system', formatDraftCommandMessage('/plan show'));
          return true;
        }
        try {
          const result = formatLatestSessionPlan(activeSessionId()!);
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
          setStatusMessage('Choose permission with O, S, or D.');
          renderer.requestRender();
        }

        return;
      }

      setInputValue('');
      resolveActivePermissionPrompt(decision);
      return;
    }

    if (permissionsEditorOpen()) {
      return;
    }

    if (activeSetupModal()) {
      return;
    }

    if (isBusy()) {
      return;
    }

    if (userInput.length === 0) {
      setInputValue('');
      return;
    }

    setInputValue('');
    setStatusMessage(null);

    const slashCommand = parseSlashCommand(userInput);
    if (slashCommand.type === 'invalid') {
      handleSlashCommand(slashCommand);
      renderer.requestRender();
      return;
    }

    if (handleSlashCommand(slashCommand)) {
      renderer.requestRender();
      return;
    }

    appendTranscriptEntry('user', rawInput);

    setIsBusy(true);
    setStatusMessage('Running turn...');

    try {
      const resolvedSessionId = ensureActiveSessionId();
      const { response } = await runSessionTurn(resolvedSessionId, rawInput, mode(), {
        workingDirectory: sessionWorkingDirectory,
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
          sessionId={activeSessionId() ?? 'new session'}
          mode={mode}
          entries={entries}
          inputValue={inputValue}
          isBusy={isBusy}
          statusMessage={statusMessage}
          permissionRequest={permissionRequest}
          permissionsEditorOpen={permissionsEditorOpen}
          activeSetupModal={activeSetupModal}
          providerSetupState={providerSetupState}
          modelsSetupState={modelsSetupState}
          permissionItems={permissionItems}
          onInput={setInputValue}
          onSubmit={() => {
            void handleSubmit();
          }}
          onExit={exitSession}
          onPermissionDecision={resolveActivePermissionPrompt}
          onClosePermissionsEditor={closePermissionsEditor}
          onCloseSetupModal={closeSetupModal}
          onCyclePermissionItem={cycleSelectedPermissionItem}
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
    setDebugLogFilePath(null);
  }

  const resolvedSessionId = activeSessionId();
  if (shouldPrintHint && resolvedSessionId) {
    printSessionContinuationHint(resolvedSessionId);
  }
}
