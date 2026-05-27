/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { useKeyboard, useTerminalDimensions } from '@opentui/solid';

import { type AgentMode } from '../agentMode';
import { type SessionEntry } from '../tui/state';

interface OpenTuiInteractiveSessionAppProps {
  sessionId: string;
  mode: () => AgentMode;
  entries: () => SessionEntry[];
  inputValue: () => string;
  isBusy: () => boolean;
  statusMessage: () => string | null;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}

function roleColor(kind: SessionEntry['kind']): string {
  if (kind === 'user') {
    return '#7dd3fc';
  }

  if (kind === 'assistant') {
    return '#f8fafc';
  }

  return '#fbbf24';
}

function roleLabel(kind: SessionEntry['kind']): string {
  if (kind === 'user') {
    return 'You';
  }

  if (kind === 'assistant') {
    return 'Agent';
  }

  return 'System';
}

export function OpenTuiInteractiveSessionApp(props: OpenTuiInteractiveSessionAppProps) {
  const dimensions = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      props.onExit();
    }
  });

  return (
    <box width="100%" height="100%" padding={1} flexDirection="column" gap={1}>
      <box
        border
        borderStyle="rounded"
        borderColor="#38bdf8"
        focusedBorderColor="#7dd3fc"
        paddingX={1}
        paddingY={0}
      >
        <text fg="#e0f2fe">
          Session: {props.sessionId} | Mode: {props.mode()} | Terminal: {dimensions().width}x
          {dimensions().height}
        </text>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor="#334155"
        focusedBorderColor="#475569"
        title="Conversation"
        padding={1}
        flexDirection="column"
        flexGrow={1}
        minHeight={10}
      >
        <scrollbox flexGrow={1} viewportCulling>
          <For each={props.entries()}>
            {(entry) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={roleColor(entry.kind)}>{roleLabel(entry.kind)}</text>
                <text>{entry.text}</text>
              </box>
            )}
          </For>

          {props.entries().length === 0 ? (
            <text fg="#94a3b8">Conversation started. Type a message or use /exit to leave.</text>
          ) : null}
        </scrollbox>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor={props.isBusy() ? '#f59e0b' : '#22c55e'}
        focusedBorderColor={props.isBusy() ? '#fbbf24' : '#4ade80'}
        title={props.isBusy() ? 'Working' : 'Message'}
        paddingX={1}
        paddingY={0}
      >
        <input
          value={props.inputValue()}
          placeholder={props.isBusy() ? 'Waiting for the current turn to finish...' : 'Type a message'}
          focused={!props.isBusy()}
          width="100%"
          textColor="#f8fafc"
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          onInput={props.onInput}
          onSubmit={props.onSubmit}
        />
      </box>

      <box justifyContent="space-between">
        <text fg="#94a3b8">/mode plan | /mode build | /plan show | /diff | /undo | /exit</text>
        <text fg={props.statusMessage() ? '#fbbf24' : '#64748b'}>
          {props.statusMessage() ?? 'Ready'}
        </text>
      </box>
    </box>
  );
}
