/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { openTuiTheme } from '../openTuiTheme';

interface CommandHint {
  key: string;
  value?: string;
}

function commandHints(isCompact: boolean): CommandHint[] {
  return [
    { key: '/connect' },
    { key: '/models' },
    { key: '/permissions' },
    { key: '/exit' },
    { key: 'ctrl+o', value: 'newline' },
  ];
}

export function CommandRail(props: {
  isCompact: boolean;
  status: string;
  statusColor: string;
}) {
  const hints = () => commandHints(props.isCompact);

  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={0}
      minHeight={1}
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={openTuiTheme.color.textFaint}>use</text>
        <text fg={openTuiTheme.color.teal}>/</text>
        <text fg={openTuiTheme.color.textFaint}>for commands</text>
        <text fg={openTuiTheme.color.ghost}>•</text>
        <For each={hints()}>
          {(hint, index) => (
            <box flexDirection="row" gap={1}>
              <text fg={openTuiTheme.color.teal}>
                {hint.key}
              </text>
              {hint.value ? (
                <text fg={openTuiTheme.color.textFaint}>
                  {hint.value}
                </text>
              ) : null}
              {index() < hints().length - 1 ? (
                <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
              ) : null}
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" flexShrink={0}>
        <text fg={props.statusColor} truncate>
          {props.status}
        </text>
      </box>
    </box>
  );
}
