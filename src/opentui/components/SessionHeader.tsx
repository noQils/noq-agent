/** @jsxImportSource @opentui/solid */

import { type AgentMode } from '../../agentMode';
import { openTuiTheme } from '../openTuiTheme';
import { formatWorkspacePathLabel } from '../workspacePathLabel';

export function SessionHeader(props: {
  sessionLabel: string;
  mode: AgentMode;
  status: string;
  statusColor: string;
  isNarrow: boolean;
  workspacePath: string;
}) {
  const workspaceLabel = formatWorkspacePathLabel(props.workspacePath);

  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={0}
      minHeight={1}
      justifyContent="space-between"
      flexDirection="row"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={openTuiTheme.color.teal} selectable={false} truncate>
          noQ
        </text>
        <text fg={openTuiTheme.color.lineStrong} selectable={false} truncate>
          {'///'}
        </text>
        <text fg={openTuiTheme.color.textMuted} truncate maxWidth={props.isNarrow ? 18 : 32}>
          {props.sessionLabel}
        </text>
        <box
          backgroundColor={
            props.mode === 'build'
              ? openTuiTheme.color.teal
              : openTuiTheme.color.amber
          }
          paddingX={1}
          flexShrink={0}
        >
          <text
            fg={openTuiTheme.color.canvas}
            selectable={false}
            truncate
          >
            {props.mode.toUpperCase()}
          </text>
        </box>
      </box>
      <box flexDirection="row" flexShrink={0} maxWidth={props.isNarrow ? 20 : 34}>
        <text fg={openTuiTheme.color.textFaint} truncate>
          {workspaceLabel}
        </text>
      </box>
    </box>
  );
}
