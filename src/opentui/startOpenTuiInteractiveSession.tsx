/** @jsxImportSource @opentui/solid */

import path from 'node:path';

import { createEffect, createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';
import { CliRenderEvents } from '@opentui/core';

import { type AgentMode } from '../agentMode';
import { resetConfigCache } from '../config/config';
import { loadAuthStore } from '../config/authStore';
import { loadGlobalConfig } from '../config/globalConfig';
import { getProviderSettings } from '../config/providerSettings';
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
  getLatestSessionDiffDetails,
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
  getModelChoices,
  getModelProviderChoices,
  saveGlobalModelSelection,
  saveProviderConnection,
} from '../setupCommands';
import { setDebugLogFilePath } from '../config/runtimeSettings';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import {
  applyOpenTuiTerminalBackground,
  resetOpenTuiTerminalBackground,
} from './openTuiTerminalAppearance';
import { OPEN_TUI_ASCII_LOGO } from './asciiLogo';
import {
  OpenTuiInteractiveSessionApp,
} from './OpenTuiInteractiveSessionApp';
import {
  getNextPermissionOutcome,
  getPermissionsEditorItems,
} from './permissionsEditorState';
import { parseSlashCommand, type SlashCommand } from './slashCommands';
import {
  type OpenTuiDiffModalState,
  type OpenTuiCurrentModelSelection,
  type OpenTuiModelsSetupRow,
  type OpenTuiModelsSetupState,
  type OpenTuiPermissionItem,
  type OpenTuiProviderSetupState,
  type OpenTuiSessionEntry,
  type OpenTuiSetupModalKind,
} from './openTuiTypes';
import { type ProviderName } from '../providers/types';
import { formatProviderLabel } from './providerLabels';

export interface StartOpenTuiInteractiveSessionOptions {
  restoreStoredMode?: boolean;
  cwd?: string;
}

interface PendingModelChange {
  fromProvider: ProviderName;
  fromModel: string;
  toProvider: ProviderName;
  toModel: string;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function providerSearchMatches(provider: ProviderName, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return true;
  }

  const candidates = [
    provider,
    formatProviderLabel(provider),
    provider.replace(/([a-z])([A-Z])/g, '$1 $2'),
  ];

  return candidates.some((candidate) => normalizeSearchText(candidate).includes(normalizedQuery));
}

function filterProviderChoices(providers: ProviderName[], query: string): ProviderName[] {
  return providers.filter((providerName) => providerSearchMatches(providerName, query));
}

function getVisibleModelRows(models: string[], query: string): OpenTuiModelsSetupRow[] {
  const normalizedQuery = normalizeSearchText(query);
  const matchedModels = normalizedQuery.length === 0
    ? models
    : models.filter((model) => normalizeSearchText(model).includes(normalizedQuery));

  return [
    ...matchedModels.map((model): OpenTuiModelsSetupRow => ({
      key: `model:${model}`,
      type: 'model',
      model,
    })),
    { key: 'custom', type: 'custom' },
  ];
}

function appendEntry(
  entries: OpenTuiSessionEntry[],
  kind: OpenTuiSessionEntry['kind'],
  text: string,
  toolName?: string,
): OpenTuiSessionEntry[] {
  return [
    ...entries,
    {
      id: `entry-${Date.now()}-${entries.length + 1}`,
      createdAt: new Date().toISOString(),
      kind,
      text,
      ...(toolName ? { toolName } : {}),
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
    OPEN_TUI_ASCII_LOGO,
  );
  console.log(`To continue this conversation use: noq --session ${sessionId}`);
}

function formatDraftCommandMessage(commandLabel: string): string {
  return `No session history exists yet. Send a prompt first, then ${commandLabel} will be available.`;
}

function printModeChange(mode: AgentMode): string {
  return `Switched to ${mode} mode.`;
}

function readCurrentModelSelection(): OpenTuiCurrentModelSelection {
  const currentConfig = loadGlobalConfig();
  return {
    provider: currentConfig.defaultProvider ?? null,
    model: currentConfig.defaultModel ?? null,
  };
}

function formatModelChangeTranscriptEntry(change: PendingModelChange): string {
  return `Model changed from ${change.fromProvider}: ${change.fromModel} to ${change.toProvider}: ${change.toModel}`;
}

function updatePendingModelChange(
  currentChange: PendingModelChange | null,
  previousProvider: ProviderName | undefined,
  previousModel: string | undefined,
  nextProvider: ProviderName,
  nextModel: string,
): PendingModelChange | null {
  if (!previousProvider || !previousModel) {
    return currentChange;
  }

  if (previousProvider === nextProvider && previousModel === nextModel) {
    return currentChange;
  }

  const nextChange: PendingModelChange = {
    fromProvider: currentChange?.fromProvider ?? previousProvider,
    fromModel: currentChange?.fromModel ?? previousModel,
    toProvider: nextProvider,
    toModel: nextModel,
  };

  if (
    nextChange.fromProvider === nextChange.toProvider
    && nextChange.fromModel === nextChange.toModel
  ) {
    return null;
  }

  return nextChange;
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
  activeDiffModal: () => OpenTuiDiffModalState | null;
  activeSetupModal: () => OpenTuiSetupModalKind | null;
  providerSetupState: () => OpenTuiProviderSetupState;
  modelsSetupState: () => OpenTuiModelsSetupState;
  providerChoices: ProviderName[];
  connectedProviders: ProviderName[];
  modelProviderChoices: ProviderName[];
  modelRows: OpenTuiModelsSetupRow[];
  selectedModelRowKey: string | null;
  permissionItems: () => OpenTuiPermissionItem[];
  workspacePath: string;
  currentModelSelection: () => OpenTuiCurrentModelSelection;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
  onClosePermissionsEditor: () => void;
  onCloseDiffModal: () => void;
  onCloseSetupModal: () => void;
  onMoveProviderSelection: (direction: -1 | 1) => void;
  onSelectProvider: (provider: ProviderName) => void;
  onProviderQueryInput: (value: string) => void;
  onProviderApiKeyInput: (value: string) => void;
  onSubmitProviderSelection: () => void;
  onSubmitProviderCredential: () => void;
  onMoveModelProviderSelection: (direction: -1 | 1) => void;
  onSelectModelProviderRow: (provider: ProviderName) => void;
  onModelProviderQueryInput: (value: string) => void;
  onSubmitModelProviderSelection: () => void;
  onMoveModelSelection: (direction: -1 | 1) => void;
  onSelectModelRow: (rowKey: string) => void;
  onModelsQueryInput: (value: string) => void;
  onModelsCustomInput: (value: string) => void;
  onSubmitModelSelection: () => void;
  onSubmitCustomModel: () => void;
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
      activeDiffModal={props.activeDiffModal}
      activeSetupModal={props.activeSetupModal}
      providerSetupState={props.providerSetupState}
      modelsSetupState={props.modelsSetupState}
      providerChoices={props.providerChoices}
      connectedProviders={props.connectedProviders}
      modelProviderChoices={props.modelProviderChoices}
      modelRows={props.modelRows}
      selectedModelRowKey={props.selectedModelRowKey}
      permissionItems={props.permissionItems}
      workspacePath={props.workspacePath}
      currentModelSelection={props.currentModelSelection}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
      onExit={props.onExit}
      onPermissionDecision={props.onPermissionDecision}
      onClosePermissionsEditor={props.onClosePermissionsEditor}
      onCloseDiffModal={props.onCloseDiffModal}
      onCloseSetupModal={props.onCloseSetupModal}
      onMoveProviderSelection={props.onMoveProviderSelection}
      onSelectProvider={props.onSelectProvider}
      onProviderQueryInput={props.onProviderQueryInput}
      onProviderApiKeyInput={props.onProviderApiKeyInput}
      onSubmitProviderSelection={props.onSubmitProviderSelection}
      onSubmitProviderCredential={props.onSubmitProviderCredential}
      onMoveModelProviderSelection={props.onMoveModelProviderSelection}
      onSelectModelProviderRow={props.onSelectModelProviderRow}
      onModelProviderQueryInput={props.onModelProviderQueryInput}
      onSubmitModelProviderSelection={props.onSubmitModelProviderSelection}
      onMoveModelSelection={props.onMoveModelSelection}
      onSelectModelRow={props.onSelectModelRow}
      onModelsQueryInput={props.onModelsQueryInput}
      onModelsCustomInput={props.onModelsCustomInput}
      onSubmitModelSelection={props.onSubmitModelSelection}
      onSubmitCustomModel={props.onSubmitCustomModel}
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
  const workspacePath = path.resolve(sessionWorkingDirectory);

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
  const [activeDiffModal, setActiveDiffModal] = createSignal<OpenTuiDiffModalState | null>(null);
  const [activeSetupModal, setActiveSetupModal] = createSignal<OpenTuiSetupModalKind | null>(null);
  const [providerSetupState, setProviderSetupState] = createSignal<OpenTuiProviderSetupState>({
    query: '',
    selectedIndex: 0,
    step: 'list',
    activeProvider: null,
    apiKeyInput: '',
  });
  const [modelsSetupState, setModelsSetupState] = createSignal<OpenTuiModelsSetupState>({
    step: 'provider',
    providerQuery: '',
    providerSelectedIndex: 0,
    activeProvider: null,
    query: '',
    selectedIndex: 0,
    customModelInput: '',
    isLoading: false,
    models: [],
    modelsSource: null,
  });
  const [permissionItems, setPermissionItems] = createSignal<OpenTuiPermissionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(sessionId ?? null);
  const [pendingModelChange, setPendingModelChange] = createSignal<PendingModelChange | null>(null);
  const [currentModelSelection, setCurrentModelSelection] = createSignal<OpenTuiCurrentModelSelection>(
    readCurrentModelSelection(),
  );
  const [statusMessageBeforeDiffModal, setStatusMessageBeforeDiffModal] = createSignal<string | null>(null);

  let shouldPrintHint = false;
  let isDestroyed = false;
  let resolvePermissionPrompt: ((decision: PermissionPromptDecision) => void) | null = null;
  let modelLoadRequestId = 0;

  const appendTranscriptEntry = (
    kind: OpenTuiSessionEntry['kind'],
    text: string,
    toolName?: string,
  ): void => {
    const nextEntries = appendEntry(entries(), kind, text, toolName);
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

  const resetSetupModalState = (): void => {
    setProviderSetupState({
      query: '',
      selectedIndex: 0,
      step: 'list',
      activeProvider: null,
      apiKeyInput: '',
    });
    setModelsSetupState({
      step: 'provider',
      providerQuery: '',
      providerSelectedIndex: 0,
      activeProvider: null,
      query: '',
      selectedIndex: 0,
      customModelInput: '',
      isLoading: false,
      models: [],
      modelsSource: null,
    });
  };

  const refreshCurrentModelSelection = (): void => {
    setCurrentModelSelection(readCurrentModelSelection());
  };

  createEffect(() => {
    refreshPermissionItems(activeSessionId());
  });

  createEffect(() => {
    if (activeSetupModal() !== 'providers' || providerSetupState().step !== 'list') {
      return;
    }

    const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
    const nextSelectedIndex = filteredProviders.length === 0
      ? 0
      : Math.min(providerSetupState().selectedIndex, filteredProviders.length - 1);
    const nextActiveProvider = filteredProviders[nextSelectedIndex] ?? null;

    if (
      nextSelectedIndex !== providerSetupState().selectedIndex
      || nextActiveProvider !== providerSetupState().activeProvider
    ) {
      setProviderSetupState((currentState) => ({
        ...currentState,
        selectedIndex: nextSelectedIndex,
        activeProvider: nextActiveProvider,
      }));
    }
  });

  createEffect(() => {
    if (activeSetupModal() !== 'models' || modelsSetupState().step !== 'provider') {
      return;
    }

    const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
    const nextSelectedIndex = filteredProviders.length === 0
      ? 0
      : Math.min(modelsSetupState().providerSelectedIndex, filteredProviders.length - 1);

    if (nextSelectedIndex !== modelsSetupState().providerSelectedIndex) {
      setModelsSetupState((currentState) => ({
        ...currentState,
        providerSelectedIndex: nextSelectedIndex,
      }));
    }
  });

  createEffect(() => {
    if (activeSetupModal() !== 'models' || modelsSetupState().step !== 'list') {
      return;
    }

    const rows = visibleModelRows();
    const nextSelectedIndex = rows.length === 0
      ? 0
      : Math.min(modelsSetupState().selectedIndex, rows.length - 1);

    if (nextSelectedIndex !== modelsSetupState().selectedIndex) {
      setModelsSetupState((currentState) => ({
        ...currentState,
        selectedIndex: nextSelectedIndex,
      }));
    }
  });

  const closePermissionsEditor = (): void => {
    setPermissionsEditorOpen(false);
    if (!isBusy()) {
      setStatusMessage('Ready');
    }
    renderer.requestRender();
  };

  const closeDiffModal = (): void => {
    setActiveDiffModal(null);
    setStatusMessage(statusMessageBeforeDiffModal());
    setStatusMessageBeforeDiffModal(null);
    renderer.requestRender();
  };

  const closeSetupModal = (): void => {
    if (activeSetupModal() === 'providers' && providerSetupState().step === 'credential') {
      const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
      const providerIndex = filteredProviders.findIndex((providerName) => providerName === providerSetupState().activeProvider);
      setProviderSetupState((currentState) => ({
        ...currentState,
        step: 'list',
        selectedIndex: providerIndex >= 0 ? providerIndex : 0,
        activeProvider: providerIndex >= 0
          ? filteredProviders[providerIndex] ?? null
          : filteredProviders[0] ?? currentState.activeProvider,
      }));
      setStatusMessage('Connect provider');
      renderer.requestRender();
      return;
    }

    if (activeSetupModal() === 'models' && modelsSetupState().step === 'custom') {
      const rows = visibleModelRows();
      const selectedIndex = rows.findIndex((row) => row.type === 'custom');
      setModelsSetupState((currentState) => ({
        ...currentState,
        step: 'list',
        selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
      }));
      setStatusMessage('Choose model');
      renderer.requestRender();
      return;
    }

    if (activeSetupModal() === 'models' && modelsSetupState().step === 'list') {
      const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
      const providerIndex = filteredProviders.findIndex((providerName) => providerName === modelsSetupState().activeProvider);
      setModelsSetupState((currentState) => ({
        ...currentState,
        step: 'provider',
        providerSelectedIndex: providerIndex >= 0 ? providerIndex : 0,
        query: '',
        selectedIndex: 0,
        models: [],
        modelsSource: null,
        isLoading: false,
      }));
      setStatusMessage('Choose provider');
      renderer.requestRender();
      return;
    }

    setActiveSetupModal(null);
    resetSetupModalState();
    if (!isBusy()) {
      setStatusMessage('Ready');
    }
    renderer.requestRender();
  };

  const closeSetupModalWithStatus = (message?: string): void => {
    setActiveSetupModal(null);
    resetSetupModalState();
    if (message) {
      setStatusMessage(message);
    }
    renderer.requestRender();
  };

  const setProviderSelectionFromQuery = (query: string): void => {
    const filteredProviders = filterProviderChoices(connectProviderChoices, query);
    setProviderSetupState((currentState) => ({
      ...currentState,
      query,
      selectedIndex: 0,
      activeProvider: filteredProviders[0] ?? null,
    }));
    renderer.requestRender();
  };

  const selectProviderByIndex = (nextIndex: number): void => {
    const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
    if (filteredProviders.length === 0) {
      setProviderSetupState((currentState) => ({
        ...currentState,
        selectedIndex: 0,
        activeProvider: null,
      }));
      renderer.requestRender();
      return;
    }

    const normalizedIndex = Math.min(Math.max(nextIndex, 0), filteredProviders.length - 1);
    setProviderSetupState((currentState) => ({
      ...currentState,
      selectedIndex: normalizedIndex,
      activeProvider: filteredProviders[normalizedIndex] ?? null,
    }));
    renderer.requestRender();
  };

  const moveSelectedProvider = (direction: -1 | 1): void => {
    const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
    if (filteredProviders.length === 0) {
      return;
    }

    const nextIndex = (providerSetupState().selectedIndex + direction + filteredProviders.length) % filteredProviders.length;
    selectProviderByIndex(nextIndex);
  };

  const submitSelectedProvider = (): void => {
    const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
    const providerName = filteredProviders[providerSetupState().selectedIndex] ?? filteredProviders[0] ?? null;
    if (!providerName) {
      setStatusMessage('No matching providers');
      renderer.requestRender();
      return;
    }

    if (providerName === 'ollama') {
      closeSetupModalWithStatus('Ollama does not need an API key');
      return;
    }

    const existingApiKey = getProviderSettings(providerName).apiKey ?? '';
    setProviderSetupState((currentState) => ({
      ...currentState,
      step: 'credential',
      activeProvider: providerName,
      apiKeyInput: existingApiKey,
    }));
    setStatusMessage(`Connect ${providerName}`);
    renderer.requestRender();
  };

  const submitProviderCredential = (): void => {
    const activeProvider = providerSetupState().activeProvider;
    if (!activeProvider || activeProvider === 'ollama') {
      return;
    }

    const apiKey = providerSetupState().apiKeyInput.trim();
    if (apiKey.length === 0) {
      setStatusMessage('API key cannot be empty');
      renderer.requestRender();
      return;
    }

    saveProviderConnection(activeProvider, { apiKey });
    resetConfigCache();
    closeSetupModalWithStatus(`Saved ${activeProvider} credentials`);
  };

  const connectedProviders = (): ProviderName[] => {
    const authStore = loadAuthStore();
    return connectProviderChoices.filter((providerName) => {
      if (providerName === 'ollama') {
        return false;
      }

      const apiKey = authStore[providerName]?.apiKey;
      return typeof apiKey === 'string' && apiKey.trim().length > 0;
    });
  };

  const visibleModelRows = (): OpenTuiModelsSetupRow[] => getVisibleModelRows(
    modelsSetupState().models,
    modelsSetupState().query,
  );

  const selectedModelRowKey = (): string | null => {
    const rows = visibleModelRows();
    return rows[modelsSetupState().selectedIndex]?.key ?? null;
  };

  const setModelsSelectionFromQuery = (query: string): void => {
    setModelsSetupState((currentState) => ({
      ...currentState,
      query,
      selectedIndex: 0,
    }));
    renderer.requestRender();
  };

  const selectModelRowBySelectableIndex = (nextIndex: number): void => {
    const rows = visibleModelRows();
    if (rows.length === 0) {
      setModelsSetupState((currentState) => ({
        ...currentState,
        selectedIndex: 0,
      }));
      renderer.requestRender();
      return;
    }

    const normalizedIndex = Math.min(Math.max(nextIndex, 0), rows.length - 1);
    setModelsSetupState((currentState) => ({
      ...currentState,
      selectedIndex: normalizedIndex,
    }));
    renderer.requestRender();
  };

  const moveSelectedModel = (direction: -1 | 1): void => {
    const rows = visibleModelRows();
    if (rows.length === 0) {
      return;
    }

    const nextIndex = (modelsSetupState().selectedIndex + direction + rows.length) % rows.length;
    selectModelRowBySelectableIndex(nextIndex);
  };

  const selectModelRowByKey = (rowKey: string): void => {
    const rows = visibleModelRows();
    const selectedIndex = rows.findIndex((row) => row.key === rowKey);
    if (selectedIndex >= 0) {
      selectModelRowBySelectableIndex(selectedIndex);
    }
  };

  const submitSelectedModelRow = (): void => {
    const rows = visibleModelRows();
    const selectedRow = rows[modelsSetupState().selectedIndex] ?? rows[0] ?? null;
    const activeProvider = modelsSetupState().activeProvider;
    if (!selectedRow || !activeProvider) {
      setStatusMessage('No matching models');
      renderer.requestRender();
      return;
    }

    if (selectedRow.type === 'custom') {
      setModelsSetupState((currentState) => ({
        ...currentState,
        step: 'custom',
        customModelInput: '',
      }));
      setStatusMessage(`Custom model for ${activeProvider}`);
      renderer.requestRender();
      return;
    }

    const currentConfig = loadGlobalConfig();
    const previousProvider = currentConfig.defaultProvider;
    const previousModel = currentConfig.defaultModel;
    saveGlobalModelSelection(activeProvider, selectedRow.model);
    refreshCurrentModelSelection();
    setPendingModelChange((currentChange) => updatePendingModelChange(
      currentChange,
      previousProvider,
      previousModel,
      activeProvider,
      selectedRow.model,
    ));
    closeSetupModalWithStatus();
  };

  const submitCustomModel = (): void => {
    const activeProvider = modelsSetupState().activeProvider;
    const modelId = modelsSetupState().customModelInput.trim();
    if (!activeProvider) {
      return;
    }

    if (modelId.length === 0) {
      setStatusMessage('Model id cannot be empty');
      renderer.requestRender();
      return;
    }

    const currentConfig = loadGlobalConfig();
    const previousProvider = currentConfig.defaultProvider;
    const previousModel = currentConfig.defaultModel;
    saveGlobalModelSelection(activeProvider, modelId);
    refreshCurrentModelSelection();
    setPendingModelChange((currentChange) => updatePendingModelChange(
      currentChange,
      previousProvider,
      previousModel,
      activeProvider,
      modelId,
    ));
    closeSetupModalWithStatus();
  };

  const setModelProviderSelectionFromQuery = (query: string): void => {
    setModelsSetupState((currentState) => ({
      ...currentState,
      providerQuery: query,
      providerSelectedIndex: 0,
    }));
    renderer.requestRender();
  };

  const selectModelProviderByIndex = (nextIndex: number): void => {
    const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
    if (filteredProviders.length === 0) {
      setModelsSetupState((currentState) => ({
        ...currentState,
        providerSelectedIndex: 0,
      }));
      renderer.requestRender();
      return;
    }

    const normalizedIndex = Math.min(Math.max(nextIndex, 0), filteredProviders.length - 1);
    setModelsSetupState((currentState) => ({
      ...currentState,
      providerSelectedIndex: normalizedIndex,
    }));
    renderer.requestRender();
  };

  const moveSelectedModelProvider = (direction: -1 | 1): void => {
    const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
    if (filteredProviders.length === 0) {
      return;
    }

    const nextIndex = (modelsSetupState().providerSelectedIndex + direction + filteredProviders.length) % filteredProviders.length;
    selectModelProviderByIndex(nextIndex);
  };

  const selectModelProvider = (provider: ProviderName): void => {
    const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
    const selectedIndex = filteredProviders.indexOf(provider);
    if (selectedIndex >= 0) {
      selectModelProviderByIndex(selectedIndex);
    }
  };

  const loadModelsForProvider = async (provider: ProviderName): Promise<void> => {
    const requestId = ++modelLoadRequestId;

    const result = await getModelChoices(provider);

    if (
      requestId !== modelLoadRequestId
      || activeSetupModal() !== 'models'
      || modelsSetupState().step !== 'list'
      || modelsSetupState().activeProvider !== provider
    ) {
      return;
    }

    setModelsSetupState((currentState) => ({
      ...currentState,
      isLoading: false,
      models: result.models,
      modelsSource: result.source,
    }));
    setStatusMessage('Choose model');
    renderer.requestRender();
  };

  const submitSelectedModelProvider = (): void => {
    const filteredProviders = filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery);
    const provider = filteredProviders[modelsSetupState().providerSelectedIndex] ?? filteredProviders[0] ?? null;
    if (!provider) {
      setStatusMessage('No matching providers');
      renderer.requestRender();
      return;
    }

    setModelsSetupState((currentState) => ({
      ...currentState,
      step: 'list',
      activeProvider: provider,
      query: '',
      selectedIndex: 0,
      isLoading: true,
      models: [],
      modelsSource: null,
    }));
    setStatusMessage('Loading models...');
    renderer.requestRender();

    void loadModelsForProvider(provider).catch((error) => {
      if (activeSetupModal() === 'models' && modelsSetupState().step === 'list' && modelsSetupState().activeProvider === provider) {
        setModelsSetupState((currentState) => ({
          ...currentState,
          isLoading: false,
        }));
        setStatusMessage(`Loading models failed: ${formatErrorMessage(error)}`);
        renderer.requestRender();
      }
    });
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
        renderer.requestRender();
        return true;

      case 'models': {
        setModelsSetupState({
          step: 'provider',
          providerQuery: '',
          providerSelectedIndex: 0,
          activeProvider: getModelProviderChoices()[0] ?? null,
          query: '',
          selectedIndex: 0,
          customModelInput: '',
          isLoading: false,
          models: [],
          modelsSource: null,
        });
        setActiveSetupModal('models');
        setStatusMessage('Choose provider');
        renderer.requestRender();
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
          const result = getLatestSessionDiffDetails(activeSessionId()!);
          setStatusMessageBeforeDiffModal(statusMessage());
          setActiveDiffModal({
            diffText: result.diffText,
            ...(result.toolName ? { toolName: result.toolName } : {}),
            ...(result.filePath ? { filePath: result.filePath } : {}),
            ...(result.filetype ? { filetype: result.filetype } : {}),
            ...(result.mutationKind ? { mutationKind: result.mutationKind } : {}),
            ...(typeof result.additionalFileCount === 'number'
              ? { additionalFileCount: result.additionalFileCount }
              : {}),
          });
          setStatusMessage('Latest diff');
          renderer.requestRender();
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

    if (activeDiffModal()) {
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

    if (pendingModelChange()) {
      appendTranscriptEntry('system', formatModelChangeTranscriptEntry(pendingModelChange()!));
      setPendingModelChange(null);
    }

    appendTranscriptEntry('user', rawInput);

    setIsBusy(true);
    setStatusMessage('Running turn...');

    try {
      const resolvedSessionId = ensureActiveSessionId();
      const { response } = await runSessionTurn(resolvedSessionId, rawInput, mode(), {
        workingDirectory: sessionWorkingDirectory,
        onMutation: (event) => {
          appendTranscriptEntry('system', event.diff, event.toolName);
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
          activeDiffModal={activeDiffModal}
          activeSetupModal={activeSetupModal}
          providerSetupState={providerSetupState}
          modelsSetupState={modelsSetupState}
          providerChoices={filterProviderChoices(connectProviderChoices, providerSetupState().query)}
          connectedProviders={connectedProviders()}
          modelProviderChoices={filterProviderChoices(getModelProviderChoices(), modelsSetupState().providerQuery)}
          modelRows={visibleModelRows()}
          selectedModelRowKey={selectedModelRowKey()}
          permissionItems={permissionItems}
          workspacePath={workspacePath}
          currentModelSelection={currentModelSelection}
          onInput={setInputValue}
          onSubmit={() => {
            void handleSubmit();
          }}
          onExit={exitSession}
          onPermissionDecision={resolveActivePermissionPrompt}
          onClosePermissionsEditor={closePermissionsEditor}
          onCloseDiffModal={closeDiffModal}
          onCloseSetupModal={closeSetupModal}
          onMoveProviderSelection={moveSelectedProvider}
          onSelectProvider={(provider: ProviderName) => {
            const filteredProviders = filterProviderChoices(connectProviderChoices, providerSetupState().query);
            const selectedIndex = filteredProviders.indexOf(provider);
            if (selectedIndex >= 0) {
              selectProviderByIndex(selectedIndex);
            }
          }}
          onProviderQueryInput={setProviderSelectionFromQuery}
          onProviderApiKeyInput={(value: string) => {
            setProviderSetupState((currentState) => ({
              ...currentState,
              apiKeyInput: value,
            }));
          }}
          onSubmitProviderSelection={submitSelectedProvider}
          onSubmitProviderCredential={submitProviderCredential}
          onMoveModelProviderSelection={moveSelectedModelProvider}
          onSelectModelProviderRow={selectModelProvider}
          onModelProviderQueryInput={setModelProviderSelectionFromQuery}
          onSubmitModelProviderSelection={submitSelectedModelProvider}
          onMoveModelSelection={moveSelectedModel}
          onSelectModelRow={selectModelRowByKey}
          onModelsQueryInput={setModelsSelectionFromQuery}
          onModelsCustomInput={(value: string) => {
            setModelsSetupState((currentState) => ({
              ...currentState,
              customModelInput: value,
            }));
          }}
          onSubmitModelSelection={submitSelectedModelRow}
          onSubmitCustomModel={submitCustomModel}
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
