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
import { PermissionPromptPanel } from './components/PermissionPromptPanel';
import { SessionHeader } from './components/SessionHeader';
import { TranscriptPanel } from './components/TranscriptPanel';
import { openTuiTheme, statusColor, statusLabel, truncateMiddle } from './openTuiTheme';
import { type OpenTuiSessionEntry } from './openTuiTypes';

interface OpenTuiInteractiveSessionAppProps {
  sessionId: string;
  mode: Accessor<AgentMode>;
  entries: Accessor<OpenTuiSessionEntry[]>;
  inputValue: Accessor<string>;
  isBusy: Accessor<boolean>;
  statusMessage: Accessor<string | null>;
  permissionRequest: Accessor<PermissionRequest | null>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
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
  const transcriptScrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3.5 });
  let cachedSelectionText = '';
  let permissionPreviewScrollBox: ScrollBoxRenderable | null = null;
  let composerTextarea: TextareaRenderable | null = null;

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
    const currentValue = props.inputValue();

    if (composerTextarea && composerTextarea.plainText !== currentValue) {
      composerTextarea.setText(currentValue);
    }
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

  const isNarrow = () => dimensions().width < 72;
  const isCompact = () => dimensions().width < 72 || dimensions().height < 22;
  const isShort = () => dimensions().height < 22;
  const isMediumTall = () => dimensions().height >= 32 && dimensions().height < 48;
  const isVeryTall = () => dimensions().height >= 48;
  const showEntryTime = () => dimensions().width >= 58;
  const resolvedStatusLabel = () => statusLabel(props.statusMessage(), props.isBusy());
  const resolvedStatusColor = () => statusColor(props.statusMessage(), props.isBusy());
  const hasPermissionRequest = () => props.permissionRequest() !== null;
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
    if (isCompact()) {
      return 0;
    }

    const width = dimensions().width;
    return Math.min(24, Math.max(8, Math.floor(width * 0.12)));
  };
  const permissionModalInsetY = () => {
    if (isCompact()) {
      return 0;
    }

    const height = dimensions().height;
    return Math.min(8, Math.max(3, Math.floor(height * 0.16)));
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

      <Composer
        inputValue={props.inputValue()}
        isBusy={props.isBusy()}
        hasPermissionRequest={hasPermissionRequest()}
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
