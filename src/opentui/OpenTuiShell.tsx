/** @jsxImportSource @opentui/solid */

import { onCleanup } from 'solid-js';

import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid';

export function OpenTuiShell() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      renderer.destroy();
    }
  });

  onCleanup(() => {
    renderer.stop();
  });

  return (
    <box width="100%" height="100%" padding={1} flexDirection="column" gap={1}>
      <box
        border
        borderStyle="rounded"
        borderColor="#4ade80"
        paddingX={1}
        paddingY={0}
      >
        <text fg="#d1fae5">
          OpenTUI shell ready | terminal {dimensions().width}x{dimensions().height}
        </text>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor="#334155"
        padding={1}
        flexDirection="column"
        gap={1}
      >
        <text fg="#f8fafc">Checkpoint 1 scaffolding is active.</text>
        <text fg="#94a3b8">
          Ink still powers the real interactive session flow. This shell proves OpenTUI can boot in
          parallel under Bun without changing the live TUI path yet.
        </text>
        <text fg="#7dd3fc">Press Esc or Ctrl+C to close.</text>
      </box>
    </box>
  );
}
