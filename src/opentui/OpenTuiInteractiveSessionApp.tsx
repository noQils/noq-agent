/** @jsxImportSource @opentui/solid */

import { For, type Accessor } from 'solid-js';

import { useKeyboard, useTerminalDimensions } from '@opentui/solid';

import { type AgentMode } from '../agentMode';

export type OpenTuiSessionEntryKind = 'user' | 'assistant' | 'system';

export interface OpenTuiSessionEntry {
  kind: OpenTuiSessionEntryKind;
  text: string;
}

interface OpenTuiInteractiveSessionAppProps {
  sessionId: string;
  mode: Accessor<AgentMode>;
  entries: Accessor<OpenTuiSessionEntry[]>;
  inputValue: Accessor<string>;
  isBusy: Accessor<boolean>;
  statusMessage: Accessor<string | null>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}

const transcriptViewportSize = 24;

function roleColor(kind: OpenTuiSessionEntry['kind']): string {
  if (kind === 'user') {
    return '#38bdf8';
  }

  if (kind === 'assistant') {
    return '#34d399';
  }

  return '#f59e0b';
}

function roleLabel(kind: OpenTuiSessionEntry['kind']): string {
  if (kind === 'user') {
    return 'You';
  }

  if (kind === 'assistant') {
    return 'Agent';
  }

  return 'System';
}

function statusToneColor(statusMessage: string | null, isBusy: boolean): string {
  if (statusMessage && statusMessage.toLowerCase().includes('failed')) {
    return '#f87171';
  }

  if (statusMessage && statusMessage.toLowerCase().includes('approval')) {
    return '#fbbf24';
  }

  if (isBusy) {
    return '#f59e0b';
  }

  return '#94a3b8';
}

function statusLabel(statusMessage: string | null, isBusy: boolean): string {
  if (statusMessage) {
    return statusMessage;
  }

  if (isBusy) {
    return 'Working';
  }

  return 'Ready';
}

function transcriptEntries(entries: OpenTuiSessionEntry[]): OpenTuiSessionEntry[] {
  if (entries.length <= transcriptViewportSize) {
    return entries;
  }

  return entries.slice(-transcriptViewportSize);
}

export function OpenTuiInteractiveSessionApp(props: OpenTuiInteractiveSessionAppProps) {
  const dimensions = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      props.onExit();
    }
  });

  const visibleEntries = () => transcriptEntries(props.entries());
  const hiddenEntryCount = () => Math.max(0, props.entries().length - visibleEntries().length);
  const statusText = () => statusLabel(props.statusMessage(), props.isBusy());
  const statusColor = () => statusToneColor(props.statusMessage(), props.isBusy());
  const composerTitle = () => (props.isBusy() ? 'Busy' : 'Composer');
  const composerBorderColor = () => (props.isBusy() ? '#f59e0b' : '#14b8a6');
  const composerFocusedBorderColor = () => (props.isBusy() ? '#fbbf24' : '#2dd4bf');
  const placeholder = () => (
    props.isBusy()
      ? 'Waiting for the current turn to finish...'
      : 'Type a message and press Enter'
  );

  return (
    <box
      width="100%"
      height="100%"
      padding={1}
      flexDirection="column"
      gap={1}
      backgroundColor="#020617"
    >
      <box
        border
        borderStyle="rounded"
        borderColor="#0f172a"
        focusedBorderColor="#1e293b"
        paddingX={1}
        paddingY={0}
        justifyContent="space-between"
      >
        <box gap={2}>
          <text fg="#e2e8f0">noq</text>
          <text fg="#38bdf8">{props.sessionId}</text>
          <text fg={props.mode() === 'plan' ? '#fbbf24' : '#34d399'}>{props.mode().toUpperCase()}</text>
        </box>
        <box gap={2}>
          <text fg={statusColor()}>{statusText()}</text>
          <text fg="#475569">
            {dimensions().width}x{dimensions().height}
          </text>
        </box>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor="#1e293b"
        focusedBorderColor="#334155"
        title="Conversation"
        padding={1}
        flexDirection="column"
        flexGrow={1}
        minHeight={10}
        backgroundColor="#020817"
      >
        {hiddenEntryCount() > 0 ? (
          <text fg="#64748b">
            Showing latest {visibleEntries().length} messages ({hiddenEntryCount()} earlier hidden)
          </text>
        ) : null}

        <scrollbox flexGrow={1} viewportCulling>
          <For each={visibleEntries()}>
            {(entry) => (
              <box
                flexDirection="column"
                marginBottom={1}
                border
                borderStyle="rounded"
                borderColor={entry.kind === 'system' ? '#3f3f46' : '#1f2937'}
                paddingX={1}
                paddingY={0}
              >
                <box justifyContent="space-between">
                  <text fg={roleColor(entry.kind)}>{roleLabel(entry.kind)}</text>
                  <text fg="#475569">{entry.kind}</text>
                </box>
                <text>{entry.text}</text>
              </box>
            )}
          </For>

          {props.entries().length === 0 ? (
            <box
              border
              borderStyle="rounded"
              borderColor="#1e293b"
              padding={1}
              flexDirection="column"
              gap={1}
            >
              <text fg="#e2e8f0">Conversation started</text>
              <text fg="#94a3b8">Type a message below, or use /exit to leave the session.</text>
              <text fg="#64748b">Plan mode can inspect and propose changes. Build mode can execute them.</text>
            </box>
          ) : null}
        </scrollbox>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor={composerBorderColor()}
        focusedBorderColor={composerFocusedBorderColor()}
        title={composerTitle()}
        paddingX={1}
        paddingY={0}
        backgroundColor="#04101f"
      >
        <input
          value={props.inputValue()}
          placeholder={placeholder()}
          focused={!props.isBusy()}
          width="100%"
          textColor="#f8fafc"
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          onInput={props.onInput}
          onSubmit={props.onSubmit}
        />
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor="#0f172a"
        focusedBorderColor="#1e293b"
        paddingX={1}
        paddingY={0}
        justifyContent="space-between"
      >
        <text fg="#94a3b8">/mode plan | /mode build | /plan show | /diff | /undo | /exit</text>
        <text fg={statusColor()}>{statusText()}</text>
      </box>
    </box>
  );
}
