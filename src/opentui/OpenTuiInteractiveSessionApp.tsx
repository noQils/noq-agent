/** @jsxImportSource @opentui/solid */

import { spawnSync } from 'node:child_process';

import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

import {
  MacOSScrollAccel,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from '@opentui/core';
import {
  useKeyboard,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
} from '@opentui/solid';

import { type AgentMode } from '../agentMode';
import { type PermissionPromptDecision } from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
import { CommandRail } from './components/CommandRail';
import { Composer } from './components/Composer';
import { ModelsPanel } from './components/ModelsPanel';
import { PermissionPromptPanel } from './components/PermissionPromptPanel';
import { PermissionsPanel } from './components/PermissionsPanel';
import { ProvidersPanel } from './components/ProvidersPanel';
import { SessionHeader } from './components/SessionHeader';
import { SlashCommandPopup } from './components/SlashCommandPopup';
import { TranscriptPanel } from './components/TranscriptPanel';
import { openTuiTheme, statusColor, statusLabel, truncateMiddle } from './openTuiTheme';
import {
  getSlashCommandExecutionText,
  getSlashCommandInsertText,
  getSlashCommandSuggestions,
} from './slashCommands';
import {
  type OpenTuiModelsSetupRow,
  type OpenTuiModelsSetupState,
  type OpenTuiPermissionItem,
  type OpenTuiProviderSetupState,
  type OpenTuiSessionEntry,
  type OpenTuiSetupModalKind,
} from './openTuiTypes';
import { type ProviderName } from '../providers/types';

interface OpenTuiInteractiveSessionAppProps {
  sessionId: string;
  mode: Accessor<AgentMode>;
  entries: Accessor<OpenTuiSessionEntry[]>;
  inputValue: Accessor<string>;
  isBusy: Accessor<boolean>;
  statusMessage: Accessor<string | null>;
  permissionRequest: Accessor<PermissionRequest | null>;
  permissionsEditorOpen: Accessor<boolean>;
  activeSetupModal: Accessor<OpenTuiSetupModalKind | null>;
  providerSetupState: Accessor<OpenTuiProviderSetupState>;
  modelsSetupState: Accessor<OpenTuiModelsSetupState>;
  providerChoices: ProviderName[];
  connectedProviders: ProviderName[];
  modelRows: OpenTuiModelsSetupRow[];
  selectedModelRowKey: string | null;
  permissionItems: Accessor<OpenTuiPermissionItem[]>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
  onClosePermissionsEditor: () => void;
  onCloseSetupModal: () => void;
  onMoveProviderSelection: (direction: -1 | 1) => void;
  onSelectProvider: (provider: ProviderName) => void;
  onProviderQueryInput: (value: string) => void;
  onProviderApiKeyInput: (value: string) => void;
  onSubmitProviderSelection: () => void;
  onSubmitProviderCredential: () => void;
  onMoveModelSelection: (direction: -1 | 1) => void;
  onSelectModelRow: (rowKey: string) => void;
  onModelsQueryInput: (value: string) => void;
  onModelsCustomInput: (value: string) => void;
  onSubmitModelSelection: () => void;
  onSubmitCustomModel: () => void;
  onCyclePermissionItem: (index: number) => void;
}

type PermissionActionId = PermissionPromptDecision;

const permissionActions: PermissionActionId[] = ['allow_once', 'allow_session', 'deny'];
let copiedSelectionText = '';

function runClipboardWriter(command: string, args: string[], text: string): boolean {
  try {
    const result = spawnSync(command, args, {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

function copyToSystemClipboard(text: string): boolean {
  if (process.platform === 'win32') {
    return (
      runClipboardWriter(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
        ],
        text,
      ) || runClipboardWriter('clip.exe', [], text)
    );
  }

  if (process.platform === 'darwin') {
    return runClipboardWriter('pbcopy', [], text);
  }

  return (
    runClipboardWriter('wl-copy', [], text)
    || runClipboardWriter('xclip', ['-selection', 'clipboard'], text)
    || runClipboardWriter('xsel', ['--clipboard', '--input'], text)
  );
}

function sanitizeInputPaste(text: string): string {
  return text.replace(/[\n\r]/g, '');
}

function busySuffix(frame: number): string {
  return '.'.repeat(frame % 4);
}

export function OpenTuiInteractiveSessionApp(props: OpenTuiInteractiveSessionAppProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [busyFrame, setBusyFrame] = createSignal(0);
  const [selectedPermissionAction, setSelectedPermissionAction] = createSignal<PermissionActionId>('allow_once');
  const [selectedPermissionItemIndex, setSelectedPermissionItemIndex] = createSignal(0);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = createSignal(0);
  const [dismissedSlashCommandQuery, setDismissedSlashCommandQuery] = createSignal('');
  const transcriptScrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3.5 });
  let lastSlashCommandQuery = '';
  let cachedSelectionText = '';
  let permissionPreviewScrollBox: ScrollBoxRenderable | null = null;
  let permissionsScrollBox: ScrollBoxRenderable | null = null;
  let providersScrollBox: ScrollBoxRenderable | null = null;
  let modelsScrollBox: ScrollBoxRenderable | null = null;
  let composerTextarea: TextareaRenderable | null = null;
  let providerSearchTextarea: TextareaRenderable | null = null;
  let providerApiKeyTextarea: TextareaRenderable | null = null;
  let modelsSearchTextarea: TextareaRenderable | null = null;
  let modelsCustomTextarea: TextareaRenderable | null = null;

  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText();
    if (selectedText.length > 0) {
      cachedSelectionText = selectedText;
    }
  });

  const copySelectionToClipboard = (): boolean => {
    const liveSelectionText = renderer.getSelection()?.getSelectedText() ?? '';
    const selectedText = liveSelectionText.length > 0 ? liveSelectionText : cachedSelectionText;
    if (selectedText.length === 0) {
      return false;
    }

    copiedSelectionText = selectedText;
    copyToSystemClipboard(selectedText);
    if (renderer.isOsc52Supported()) {
      renderer.copyToClipboardOSC52(selectedText);
    }

    renderer.clearSelection();
    cachedSelectionText = '';
    renderer.requestRender();

    return true;
  };

  const pasteCopiedSelectionIntoInput = (): boolean => {
    if (props.isBusy() || props.permissionRequest() || copiedSelectionText.length === 0) {
      return false;
    }

    const pastedText = sanitizeInputPaste(copiedSelectionText);
    if (pastedText.length === 0) {
      return false;
    }

    props.onInput(`${props.inputValue()}${pastedText}`);
    renderer.requestRender();
    return true;
  };

  const stopPermissionKeyEvent = (key: { preventDefault: () => void; stopPropagation: () => void }): void => {
    key.preventDefault();
    key.stopPropagation();
  };

  const choosePermissionAction = (action: PermissionActionId): void => {
    props.onPermissionDecision(action);
  };

  const moveSelectedPermissionAction = (direction: -1 | 1): void => {
    const currentIndex = permissionActions.indexOf(selectedPermissionAction());
    const nextIndex = (currentIndex + direction + permissionActions.length) % permissionActions.length;
    setSelectedPermissionAction(permissionActions[nextIndex] ?? 'allow_once');
    renderer.requestRender();
  };

  const scrollPermissionPreview = (direction: -1 | 1): void => {
    permissionPreviewScrollBox?.scrollBy(direction * 3, 'step');
    renderer.requestRender();
  };

  const moveSelectedPermissionItem = (direction: -1 | 1): void => {
    const items = props.permissionItems();
    if (items.length === 0) {
      return;
    }

    const nextIndex = (selectedPermissionItemIndex() + direction + items.length) % items.length;
    setSelectedPermissionItemIndex(nextIndex);
    permissionsScrollBox?.scrollBy(direction, 'step');
    renderer.requestRender();
  };

  const moveSelectedSlashCommand = (direction: -1 | 1): void => {
    const matches = getSlashCommandSuggestions(props.inputValue()).matches;
    if (matches.length === 0) {
      return;
    }

    const nextIndex = (selectedSlashCommandIndex() + direction + matches.length) % matches.length;
    setSelectedSlashCommandIndex(nextIndex);
    renderer.requestRender();
  };

  const dismissSlashCommandPopup = (): void => {
    const { query } = getSlashCommandSuggestions(props.inputValue());
    setDismissedSlashCommandQuery(query);
    renderer.requestRender();
  };

  const acceptSelectedSlashCommandForInsertion = (): boolean => {
    const suggestions = getSlashCommandSuggestions(props.inputValue());
    const selectedEntry = suggestions.matches[selectedSlashCommandIndex()];
    if (!selectedEntry) {
      return false;
    }

    const nextValue = getSlashCommandInsertText(selectedEntry);
    setDismissedSlashCommandQuery(nextValue);
    composerTextarea?.setText(nextValue);
    composerTextarea?.focus();
    composerTextarea && (composerTextarea.cursorOffset = nextValue.length);
    props.onInput(nextValue);
    renderer.requestRender();
    return true;
  };

  const executeSelectedSlashCommandImmediately = (): boolean => {
    const suggestions = getSlashCommandSuggestions(props.inputValue());
    const selectedEntry = suggestions.matches[selectedSlashCommandIndex()];
    if (!selectedEntry) {
      return false;
    }

    const nextValue = getSlashCommandExecutionText(selectedEntry);
    setDismissedSlashCommandQuery(nextValue);
    props.onInput(nextValue);
    renderer.requestRender();
    props.onSubmit();
    return true;
  };

  useKeyboard((key) => {
    const keyName = key.name.toLowerCase();

    if (key.ctrl && keyName === 'c') {
      copySelectionToClipboard();
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (key.ctrl && keyName === 'v' && pasteCopiedSelectionIntoInput()) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (props.permissionRequest()) {
      if (keyName === 'left') {
        moveSelectedPermissionAction(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'right') {
        moveSelectedPermissionAction(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (key.shift && keyName === 'up') {
        scrollPermissionPreview(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (key.shift && keyName === 'down') {
        scrollPermissionPreview(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'enter' || keyName === 'return') {
        choosePermissionAction(selectedPermissionAction());
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'o') {
        choosePermissionAction('allow_once');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 's') {
        choosePermissionAction('allow_session');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'd') {
        choosePermissionAction('deny');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'escape') {
        choosePermissionAction('deny');
        stopPermissionKeyEvent(key);
        return;
      }

      stopPermissionKeyEvent(key);
      return;
    }

    if (props.permissionsEditorOpen()) {
      if (keyName === 'up') {
        moveSelectedPermissionItem(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'down') {
        moveSelectedPermissionItem(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'enter' || keyName === 'return') {
        props.onCyclePermissionItem(selectedPermissionItemIndex());
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'escape') {
        props.onClosePermissionsEditor();
        stopPermissionKeyEvent(key);
        return;
      }

      stopPermissionKeyEvent(key);
      return;
    }

    if (props.activeSetupModal() === 'providers') {
      if (keyName === 'escape') {
        props.onCloseSetupModal();
        stopPermissionKeyEvent(key);
        return;
      }

      if (props.providerSetupState().step === 'list') {
        if (keyName === 'up') {
          props.onMoveProviderSelection(-1);
          providersScrollBox?.scrollBy(-1, 'step');
          stopPermissionKeyEvent(key);
          return;
        }

        if (keyName === 'down') {
          props.onMoveProviderSelection(1);
          providersScrollBox?.scrollBy(1, 'step');
          stopPermissionKeyEvent(key);
          return;
        }

        if (keyName === 'enter' || keyName === 'return' || keyName === 'kpenter') {
          props.onSubmitProviderSelection();
          stopPermissionKeyEvent(key);
          return;
        }

        return;
      }

      if (keyName === 'enter' || keyName === 'return' || keyName === 'kpenter') {
        props.onSubmitProviderCredential();
        stopPermissionKeyEvent(key);
        return;
      }

      return;
    }

    if (props.activeSetupModal() === 'models') {
      if (keyName === 'escape') {
        props.onCloseSetupModal();
        stopPermissionKeyEvent(key);
        return;
      }

      if (props.modelsSetupState().step === 'list') {
        if (keyName === 'up') {
          props.onMoveModelSelection(-1);
          modelsScrollBox?.scrollBy(-1, 'step');
          stopPermissionKeyEvent(key);
          return;
        }

        if (keyName === 'down') {
          props.onMoveModelSelection(1);
          modelsScrollBox?.scrollBy(1, 'step');
          stopPermissionKeyEvent(key);
          return;
        }

        if (keyName === 'enter' || keyName === 'return' || keyName === 'kpenter') {
          props.onSubmitModelSelection();
          stopPermissionKeyEvent(key);
          return;
        }

        return;
      }

      if (keyName === 'enter' || keyName === 'return' || keyName === 'kpenter') {
        props.onSubmitCustomModel();
        stopPermissionKeyEvent(key);
        return;
      }

      return;
    }

    if (props.activeSetupModal()) {
      if (keyName === 'escape') {
        props.onCloseSetupModal();
        stopPermissionKeyEvent(key);
        return;
      }

      stopPermissionKeyEvent(key);
      return;
    }

    if (slashCommandPopupVisible()) {
      if (keyName === 'up') {
        moveSelectedSlashCommand(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'down') {
        moveSelectedSlashCommand(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'tab') {
        if (acceptSelectedSlashCommandForInsertion()) {
          stopPermissionKeyEvent(key);
          return;
        }
      }

      if (keyName === 'enter' || keyName === 'return' || keyName === 'kpenter') {
        const selectedEntry = slashCommandSuggestions().matches[selectedSlashCommandIndex()];
        const handled = selectedEntry?.acceptBehavior === 'insert'
          ? acceptSelectedSlashCommandForInsertion()
          : executeSelectedSlashCommandImmediately();

        if (handled) {
          stopPermissionKeyEvent(key);
          return;
        }
      }

      if (keyName === 'escape') {
        dismissSlashCommandPopup();
        stopPermissionKeyEvent(key);
        return;
      }
    }

    if (keyName === 'escape') {
      props.onExit();
    }
  });

  createEffect(() => {
    if (props.permissionRequest()) {
      setSelectedPermissionAction('allow_once');
      permissionPreviewScrollBox?.scrollTo(0);
    }
  });

  createEffect(() => {
    if (props.permissionsEditorOpen()) {
      setSelectedPermissionItemIndex(0);
      permissionsScrollBox?.scrollTo(0);
    }
  });

  createEffect(() => {
    const currentValue = props.inputValue();

    if (composerTextarea && composerTextarea.plainText !== currentValue) {
      composerTextarea.setText(currentValue);
    }
  });

  createEffect(() => {
    if (props.activeSetupModal() !== 'providers') {
      return;
    }

    if (props.providerSetupState().step === 'list') {
      if (providerSearchTextarea && providerSearchTextarea.plainText !== props.providerSetupState().query) {
        providerSearchTextarea.setText(props.providerSetupState().query);
        providerSearchTextarea.cursorOffset = props.providerSetupState().query.length;
      }
      providerSearchTextarea?.focus();
      return;
    }

    if (providerApiKeyTextarea && providerApiKeyTextarea.plainText !== props.providerSetupState().apiKeyInput) {
      providerApiKeyTextarea.setText(props.providerSetupState().apiKeyInput);
      providerApiKeyTextarea.cursorOffset = props.providerSetupState().apiKeyInput.length;
    }
    providerApiKeyTextarea?.focus();
  });

  createEffect(() => {
    if (props.activeSetupModal() !== 'models') {
      return;
    }

    if (props.modelsSetupState().step === 'list') {
      if (modelsSearchTextarea && modelsSearchTextarea.plainText !== props.modelsSetupState().query) {
        modelsSearchTextarea.setText(props.modelsSetupState().query);
        modelsSearchTextarea.cursorOffset = props.modelsSetupState().query.length;
      }
      modelsSearchTextarea?.focus();
      return;
    }

    if (modelsCustomTextarea && modelsCustomTextarea.plainText !== props.modelsSetupState().customModelInput) {
      modelsCustomTextarea.setText(props.modelsSetupState().customModelInput);
      modelsCustomTextarea.cursorOffset = props.modelsSetupState().customModelInput.length;
    }
    modelsCustomTextarea?.focus();
  });

  createEffect(() => {
    if (!props.isBusy()) {
      setBusyFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setBusyFrame((currentFrame) => (currentFrame + 1) % 4);
    }, 240);

    onCleanup(() => {
      clearInterval(interval);
    });
  });

  createEffect(() => {
    const suggestionState = getSlashCommandSuggestions(props.inputValue());

    if (!suggestionState.visible || suggestionState.matches.length === 0) {
      lastSlashCommandQuery = '';
      setDismissedSlashCommandQuery('');
      setSelectedSlashCommandIndex(0);
      return;
    }

    if (suggestionState.query !== lastSlashCommandQuery) {
      lastSlashCommandQuery = suggestionState.query;
      setSelectedSlashCommandIndex(0);
      if (dismissedSlashCommandQuery() !== suggestionState.query) {
        setDismissedSlashCommandQuery('');
      }
      return;
    }

    setSelectedSlashCommandIndex((currentIndex) => {
      if (currentIndex < 0) {
        return 0;
      }

      if (currentIndex >= suggestionState.matches.length) {
        return suggestionState.matches.length - 1;
      }

      return currentIndex;
    });
  });

  const isNarrow = () => dimensions().width < 72;
  const isCompact = () => dimensions().width < 72 || dimensions().height < 22;
  const isShort = () => dimensions().height < 22;
  const isMediumTall = () => dimensions().height >= 32 && dimensions().height < 48;
  const isVeryTall = () => dimensions().height >= 48;
  const showEntryTime = () => dimensions().width >= 58;
  const resolvedStatusLabel = () => statusLabel(props.statusMessage(), props.isBusy());
  const resolvedStatusColor = () => statusColor(props.statusMessage(), props.isBusy());
  const hasPermissionRequest = () => props.permissionRequest() !== null;
  const hasModalOverlay = () => hasPermissionRequest() || props.permissionsEditorOpen() || props.activeSetupModal() !== null;
  const slashCommandSuggestions = () => getSlashCommandSuggestions(props.inputValue());
  const slashCommandPopupVisible = () => (
    slashCommandSuggestions().visible
    && slashCommandSuggestions().matches.length > 0
    && dismissedSlashCommandQuery() !== slashCommandSuggestions().query
    && !props.isBusy()
    && !hasModalOverlay()
  );
  const animatedStatus = () => (
    props.isBusy()
      ? `${resolvedStatusLabel()}${busySuffix(busyFrame())}`
      : resolvedStatusLabel()
  );
  const sessionLabel = () => truncateMiddle(props.sessionId, isNarrow() ? 18 : 32);
  const permissionPreviewMaxLength = () => {
    const widthRatio = isCompact() ? 0.82 : 0.72;
    const maxLength = isCompact() ? 70 : 96;
    return Math.min(maxLength, Math.max(24, Math.floor(dimensions().width * widthRatio) - 8));
  };
  const permissionModalInsetX = () => {
    if (isNarrow()) {
      return 0;
    }

    const width = dimensions().width;
    return Math.min(32, Math.max(10, Math.floor(width * 0.21)));
  };
  const permissionModalInsetY = () => {
    if (isShort()) {
      return 0;
    }

    const height = dimensions().height;
    return Math.min(8, Math.max(3, Math.floor(height * 0.16)));
  };
  const permissionsEditorMaxWidth = 72;
  const permissionsEditorMaxHeight = 22;
  const permissionsEditorInsetX = () => {
    if (isNarrow()) {
      return 0;
    }

    const width = dimensions().width;
    if (width <= permissionsEditorMaxWidth) {
      return 0;
    }

    return Math.max(0, Math.floor((width - permissionsEditorMaxWidth) / 2));
  };
  const permissionsEditorInsetY = () => {
    if (isShort()) {
      return 0;
    }

    const height = dimensions().height;
    if (height <= permissionsEditorMaxHeight) {
      return 0;
    }

    return Math.max(0, Math.floor((height - permissionsEditorMaxHeight) / 2));
  };

  return (
    <box
      width="100%"
      height="100%"
      padding={1}
      flexDirection="column"
      gap={0}
      backgroundColor={openTuiTheme.color.canvas}
    >
      <SessionHeader
        sessionLabel={sessionLabel()}
        mode={props.mode()}
        status={animatedStatus()}
        statusColor={resolvedStatusColor()}
        isNarrow={isNarrow()}
      />

      <TranscriptPanel
        entries={props.entries()}
        isCompact={isCompact()}
        isShort={isShort()}
        showEntryTime={showEntryTime()}
        scrollAcceleration={transcriptScrollAcceleration}
      />

      {props.permissionRequest() ? (
        <box
          border
          borderStyle="rounded"
          borderColor={openTuiTheme.color.amber}
          focusedBorderColor={openTuiTheme.color.amber}
          backgroundColor={openTuiTheme.color.canvas}
          position="absolute"
          top={permissionModalInsetY()}
          right={permissionModalInsetX()}
          bottom={permissionModalInsetY()}
          left={permissionModalInsetX()}
          zIndex={1}
        >
          <PermissionPromptPanel
            request={props.permissionRequest()!}
            targetMaxLength={isNarrow() ? 36 : 76}
            previewMaxLength={permissionPreviewMaxLength()}
            selectedAction={selectedPermissionAction()}
            onAction={choosePermissionAction}
            previewScrollRef={(scrollbox) => {
              permissionPreviewScrollBox = scrollbox;
            }}
          />
        </box>
      ) : null}

      {props.permissionsEditorOpen() ? (
        <box
          position="absolute"
          top={permissionsEditorInsetY()}
          right={permissionsEditorInsetX()}
          bottom={permissionsEditorInsetY()}
          left={permissionsEditorInsetX()}
          zIndex={1}
        >
          <PermissionsPanel
            items={props.permissionItems()}
            selectedIndex={selectedPermissionItemIndex()}
            onCycle={() => props.onCyclePermissionItem(selectedPermissionItemIndex())}
            scrollRef={(scrollbox) => {
              permissionsScrollBox = scrollbox;
            }}
          />
        </box>
      ) : null}

      {props.activeSetupModal() === 'providers' ? (
        <box
          position="absolute"
          top={permissionsEditorInsetY()}
          right={permissionsEditorInsetX()}
          bottom={permissionsEditorInsetY()}
          left={permissionsEditorInsetX()}
          zIndex={1}
        >
          <ProvidersPanel
            providers={props.providerChoices}
            connectedProviders={props.connectedProviders}
            selectedIndex={props.providerSetupState().selectedIndex}
            query={props.providerSetupState().query}
            step={props.providerSetupState().step}
            activeProvider={props.providerSetupState().activeProvider}
            apiKeyInput={props.providerSetupState().apiKeyInput}
            onQueryInput={props.onProviderQueryInput}
            onApiKeyInput={props.onProviderApiKeyInput}
            onSubmitSelection={props.onSubmitProviderSelection}
            onSubmitCredential={props.onSubmitProviderCredential}
            onSelectProvider={props.onSelectProvider}
            scrollRef={(scrollbox) => {
              providersScrollBox = scrollbox;
            }}
            searchInputRef={(textarea) => {
              providerSearchTextarea = textarea;
            }}
            apiKeyInputRef={(textarea) => {
              providerApiKeyTextarea = textarea;
            }}
          />
        </box>
      ) : null}

      {props.activeSetupModal() === 'models' ? (
        <box
          position="absolute"
          top={permissionsEditorInsetY()}
          right={permissionsEditorInsetX()}
          bottom={permissionsEditorInsetY()}
          left={permissionsEditorInsetX()}
          zIndex={1}
        >
          <ModelsPanel
            rows={props.modelRows}
            selectedRowKey={props.selectedModelRowKey}
            query={props.modelsSetupState().query}
            step={props.modelsSetupState().step}
            activeProvider={props.modelsSetupState().activeProvider}
            customModelInput={props.modelsSetupState().customModelInput}
            isLoading={props.modelsSetupState().isLoading}
            onQueryInput={props.onModelsQueryInput}
            onCustomModelInput={props.onModelsCustomInput}
            onSubmitSelection={props.onSubmitModelSelection}
            onSubmitCustom={props.onSubmitCustomModel}
            onSelectRow={props.onSelectModelRow}
            scrollRef={(scrollbox) => {
              modelsScrollBox = scrollbox;
            }}
            searchInputRef={(textarea) => {
              modelsSearchTextarea = textarea;
            }}
            customInputRef={(textarea) => {
              modelsCustomTextarea = textarea;
            }}
          />
        </box>
      ) : null}

      {slashCommandPopupVisible() ? (
        <SlashCommandPopup
          matches={slashCommandSuggestions().matches}
          selectedIndex={selectedSlashCommandIndex()}
          isMediumTall={isMediumTall()}
          isVeryTall={isVeryTall()}
          width={Math.max(28, dimensions().width - 6)}
        />
      ) : null}

      <Composer
        inputValue={props.inputValue()}
        isBusy={props.isBusy()}
        hasModalOverlay={hasModalOverlay()}
        isNarrow={isNarrow()}
        isCompact={isCompact()}
        isMediumTall={isMediumTall()}
        isVeryTall={isVeryTall()}
        width={dimensions().width}
        onInput={props.onInput}
        onSubmit={props.onSubmit}
        textareaRef={(textarea) => {
          composerTextarea = textarea;
        }}
      />

      <CommandRail isCompact={isCompact()} />
    </box>
  );
}
