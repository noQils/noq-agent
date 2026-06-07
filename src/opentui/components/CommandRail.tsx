/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { openTuiTheme } from '../openTuiTheme';

interface CommandHint {
  key: string;
  value?: string;
}

function commandHints(isCompact: boolean): CommandHint[] {
  if (isCompact) {
    return [
      { key: '/mode' },
      { key: '/permissions' },
      { key: '/connect' },
      { key: '/models' },
      { key: '/exit' },
      { key: 'ctrl+o', value: 'newline' },
    ];
  }

  return [
    { key: '/mode', value: 'plan|build' },
    { key: '/permissions' },
    { key: '/connect' },
    { key: '/models' },
    { key: '/plan', value: 'show' },
    { key: '/diff' },
    { key: '/undo' },
    { key: '/exit' },
    { key: 'ctrl+o', value: 'newline' },
  ];
}

export function CommandRail(props: { isCompact: boolean }) {
  const hints = () => commandHints(props.isCompact);

  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={0}
      minHeight={1}
      flexDirection="row"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <For each={hints()}>
          {(hint, index) => (
            <box flexDirection="row" gap={1}>
              <text fg={openTuiTheme.color.teal} truncate>
                {hint.key}
              </text>
              {hint.value ? (
                <text fg={openTuiTheme.color.textFaint} truncate>
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
    </box>
  );
}
