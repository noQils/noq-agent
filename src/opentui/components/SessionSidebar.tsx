/** @jsxImportSource @opentui/solid */

import { type AgentMode } from '../../agentMode';
import { type OpenTuiCurrentModelSelection } from '../openTuiTypes';
import { openTuiTheme, truncateMiddle } from '../openTuiTheme';
import { formatProviderLabel } from '../providerLabels';

function sectionLabel(label: string) {
  return (
    <text fg={openTuiTheme.color.textFaint}>
      {label}
    </text>
  );
}

function modeBadgeColor(mode: AgentMode): string {
  return mode === 'build'
    ? openTuiTheme.color.teal
    : openTuiTheme.color.amber;
}

function modelProviderLabel(selection: OpenTuiCurrentModelSelection): string {
  if (!selection.provider) {
    return 'Not configured';
  }

  return formatProviderLabel(selection.provider);
}

function modelIdLabel(selection: OpenTuiCurrentModelSelection): string {
  return selection.model ?? 'Not configured';
}

export function SessionSidebar(props: {
  sessionId: string;
  mode: AgentMode;
  currentModelSelection: OpenTuiCurrentModelSelection;
  workspacePath: string;
}) {
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      backgroundColor={openTuiTheme.color.canvas}
      flexShrink={0}
      overflow="hidden"
      gap={1}
    >
      <box flexDirection="column">
        <text fg={openTuiTheme.color.teal} selectable={false}>
{`
████████╗ ██████╗  ██████╗
██╔═══██║██╔═══██╗██╔═══██╗
██║   ██║██║   ██║██║   ██║
██║   ██║╚██████╔╝╚██████╔╝
╚═╝   ╚═╝ ╚═════╝  ╚══▀█▄╗
                       ╚═╝
`}
        </text>
      </box>
      <box backgroundColor={modeBadgeColor(props.mode)} paddingX={1} width={7}>
        <text fg={openTuiTheme.color.canvas} selectable={false} truncate>
          {props.mode.toUpperCase()}
        </text>
      </box>
      <box flexDirection="column">
        {sectionLabel('Session ID')}
        <text fg={openTuiTheme.color.textSoft} truncate>
          {props.sessionId}
        </text>
      </box>

      <box flexDirection="column">
        {sectionLabel('Model')}
        <text fg={openTuiTheme.color.text} truncate>
          {modelIdLabel(props.currentModelSelection)}
        </text>
        <text fg={openTuiTheme.color.ghost} truncate>
          via {modelProviderLabel(props.currentModelSelection)}
        </text>
      </box>

      <box flexDirection="column">
        {sectionLabel('Workspace')}
        <text fg={openTuiTheme.color.textSoft} truncate>
          {props.workspacePath}
        </text>
      </box>
    </box>
  );
}
