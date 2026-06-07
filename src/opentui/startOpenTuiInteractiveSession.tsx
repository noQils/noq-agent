/** @jsxImportSource @opentui/solid */

import { createSignal } from 'solid-js';

import { render, useRenderer } from '@opentui/solid';
import { CliRenderEvents } from '@opentui/core';

import { isAgentMode, type AgentMode } from '../agentMode';
import { resetConfigCache } from '../config';
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
  undoLastSessionSnapshot,
} from '../sessionStore';
import { runSessionTurn } from '../sessionTurnRunner';
import {
  connectProviderChoices,
  getModelChoices,
  formatModelChoiceList,
  formatProviderChoiceList,
  getModelProviderChoices,
  parseModelChoice,
  parseProviderChoice,
  saveGlobalModelSelection,
  saveProviderConnection,
} from '../setupCommands';
import { setDebugLogFilePath } from '../runtimeSettings';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';
import {
  applyOpenTuiTerminalBackground,
  resetOpenTuiTerminalBackground,
} from './openTuiTerminalAppearance';
import {
  OpenTuiInteractiveSessionApp,
} from './OpenTuiInteractiveSessionApp';
import { type OpenTuiSessionEntry } from './openTuiTypes';

export interface StartOpenTuiInteractiveSessionOptions {
  restoreStoredMode?: boolean;
  cwd?: string;
}

type SlashCommand =
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'connect' }
  | { type: 'models' }
  | { type: 'exit' }
  | { type: 'diff' }
  | { type: 'undo' }
  | { type: 'plan_show' }
  | { type: 'mode'; mode: AgentMode };

type SetupFlow =
  | {
      type: 'connect_provider';
      providers: typeof connectProviderChoices;
    }
  | {
      type: 'connect_api_key';
      provider: 'openai' | 'openrouter' | 'gemini';
    }
  | {
      type: 'models_provider';
      providers: ProviderName[];
    }
  | {
      type: 'models_choice';
      provider: ProviderName;
      models: string[];
      source: 'live' | 'fallback';
    }
  | {
      type: 'models_custom';
      provider: ProviderName;
    };

type ProviderName = typeof connectProviderChoices[number];

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

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

function parseSlashCommand(inputLine: string): SlashCommand {
  if (inputLine === '/connect') {
    return { type: 'connect' };
  }

  if (inputLine === '/models') {
    return { type: 'models' };
  }

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

function formatConnectPrompt(providers: ProviderName[]): string {
  return [
    'Connect a provider.',
    '',
    formatProviderChoiceList(providers),
    '',
    'Choose a provider by number or name. Type /cancel to stop.',
  ].join('\n');
}

function formatConnectApiKeyPrompt(provider: 'openai' | 'openrouter' | 'gemini'): string {
  return [
    `Enter the API key for ${provider}.`,
    `It will be saved to your global auth store at setup time.`,
    'Type /cancel to stop.',
  ].join('\n');
}

function formatModelsPrompt(providers: ProviderName[]): string {
  return [
    'Choose which provider should own the global default model.',
    '',
    formatProviderChoiceList(providers),
    '',
    'Configured providers are listed first. Choose by number or name. Type /cancel to stop.',
  ].join('\n');
}

function formatModelPresetPrompt(
  provider: ProviderName,
  models: string[],
  source: 'live' | 'fallback',
): string {
  return [
    `Choose a default model for ${provider}.`,
    source === 'live'
      ? 'Live models fetched from the provider.'
      : 'Using fallback presets because live model discovery was unavailable.',
    '',
    formatModelChoiceList(models),
    '',
    'Choose by number, or type "custom" to enter a model id. Type /cancel to stop.',
  ].join('\n');
}

function formatCustomModelPrompt(provider: ProviderName): string {
  return [
    `Enter a custom model id for ${provider}.`,
    'Type /cancel to stop.',
  ].join('\n');
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
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(sessionId ?? null);
  const [setupFlow, setSetupFlow] = createSignal<SetupFlow | null>(null);

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
        setSetupFlow({
          type: 'connect_provider',
          providers: connectProviderChoices,
        });
        appendTranscriptEntry('system', formatConnectPrompt(connectProviderChoices));
        setStatusMessage('Setup: connect provider');
        return true;

      case 'models': {
        const providers = getModelProviderChoices();
        setSetupFlow({
          type: 'models_provider',
          providers,
        });
        appendTranscriptEntry('system', formatModelsPrompt(providers));
        setStatusMessage('Setup: choose model provider');
        return true;
      }

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

  const handleSetupFlowInput = async (rawInputValue: string, userInputValue: string): Promise<boolean> => {
    const activeSetupFlow = setupFlow();
    if (!activeSetupFlow) {
      return false;
    }

    if (userInputValue === '/cancel') {
      appendTranscriptEntry('system', 'Setup cancelled.');
      setSetupFlow(null);
      setStatusMessage('Ready');
      return true;
    }

    appendTranscriptEntry('user', rawInputValue);

    switch (activeSetupFlow.type) {
      case 'connect_provider': {
        const providerName = parseProviderChoice(userInputValue, activeSetupFlow.providers);
        if (!providerName) {
          appendTranscriptEntry('system', 'Choose a valid provider by number or name, or type /cancel.');
          return true;
        }

        if (providerName === 'ollama') {
          appendTranscriptEntry(
            'system',
            'Ollama does not need an API key. Run /models to choose a default Ollama model.',
          );
          setSetupFlow(null);
          setStatusMessage('Setup completed');
          return true;
        }

        setSetupFlow({
          type: 'connect_api_key',
          provider: providerName,
        });
        appendTranscriptEntry('system', formatConnectApiKeyPrompt(providerName));
        setStatusMessage(`Setup: ${providerName} API key`);
        return true;
      }

      case 'connect_api_key': {
        if (userInputValue.length === 0) {
          appendTranscriptEntry('system', 'API key cannot be empty. Type /cancel to stop.');
          return true;
        }

        const authStorePath = saveProviderConnection(activeSetupFlow.provider, {
          apiKey: userInputValue,
        });
        resetConfigCache();
        appendTranscriptEntry(
          'system',
          `Saved ${activeSetupFlow.provider} credentials to ${authStorePath}. ${activeSetupFlow.provider} is now available to select. Run /models to choose the active default provider and model.`,
        );
        setSetupFlow(null);
        setStatusMessage('Setup completed');
        return true;
      }

      case 'models_provider': {
        const providerName = parseProviderChoice(userInputValue, activeSetupFlow.providers);
        if (!providerName) {
          appendTranscriptEntry('system', 'Choose a valid provider by number or name, or type /cancel.');
          return true;
        }

        setIsBusy(true);
        setStatusMessage(`Loading ${providerName} models...`);
        renderer.requestRender();

        const modelChoices = await getModelChoices(providerName);

        setSetupFlow({
          type: 'models_choice',
          provider: providerName,
          models: modelChoices.models,
          source: modelChoices.source,
        });
        appendTranscriptEntry(
          'system',
          formatModelPresetPrompt(providerName, modelChoices.models, modelChoices.source),
        );
        setIsBusy(false);
        setStatusMessage(
          modelChoices.source === 'live'
            ? `Setup: ${providerName} models loaded`
            : `Setup: ${providerName} using fallback models`,
        );
        return true;
      }

      case 'models_choice': {
        const parsedChoice = parseModelChoice(
          userInputValue,
          activeSetupFlow.models.length,
        );
        if (parsedChoice === null) {
          appendTranscriptEntry('system', 'Choose a valid model option by number, or type custom / /cancel.');
          return true;
        }

        if (parsedChoice === 'custom') {
          setSetupFlow({
            type: 'models_custom',
            provider: activeSetupFlow.provider,
          });
          appendTranscriptEntry('system', formatCustomModelPrompt(activeSetupFlow.provider));
          setStatusMessage(`Setup: custom ${activeSetupFlow.provider} model`);
          return true;
        }

        const model = activeSetupFlow.models[parsedChoice];
        const configPath = saveGlobalModelSelection(activeSetupFlow.provider, model!);
        appendTranscriptEntry(
          'system',
          `Saved global default provider "${activeSetupFlow.provider}" and model "${model}" to ${configPath}. The next turn in this session will use them immediately.`,
        );
        setSetupFlow(null);
        setStatusMessage(`Active model: ${activeSetupFlow.provider} / ${model}`);
        return true;
      }

      case 'models_custom': {
        if (userInputValue.length === 0) {
          appendTranscriptEntry('system', 'Model id cannot be empty. Type /cancel to stop.');
          return true;
        }

        const configPath = saveGlobalModelSelection(activeSetupFlow.provider, userInputValue);
        appendTranscriptEntry(
          'system',
          `Saved global default provider "${activeSetupFlow.provider}" and model "${userInputValue}" to ${configPath}. The next turn in this session will use them immediately.`,
        );
        setSetupFlow(null);
        setStatusMessage(`Active model: ${activeSetupFlow.provider} / ${userInputValue}`);
        return true;
      }
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

    if (isBusy()) {
      return;
    }

    if (userInput.length === 0) {
      setInputValue('');
      return;
    }

    setInputValue('');
    setStatusMessage(null);

    if (setupFlow()) {
      try {
        if (await handleSetupFlowInput(rawInput, userInput)) {
          renderer.requestRender();
          return;
        }
      } catch (error) {
        appendTranscriptEntry('system', `Setup failed: ${formatErrorMessage(error)}`);
        setSetupFlow(null);
        setIsBusy(false);
        setStatusMessage('Setup failed');
        renderer.requestRender();
        return;
      } finally {
        if (setupFlow()?.type !== 'models_provider') {
          setIsBusy(false);
        }
      }
    }

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
    setDebugLogFilePath(null);
  }

  const resolvedSessionId = activeSessionId();
  if (shouldPrintHint && resolvedSessionId) {
    printSessionContinuationHint(resolvedSessionId);
  }
}
