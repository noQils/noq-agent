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
      backgroundColor={openTuiTheme.color.panelRaised}
      gap={1}
    >
      <box
        flexDirection="column"
        border={['bottom']}
        borderColor={openTuiTheme.color.line}
        paddingBottom={1}
      >
        {sectionLabel('Session')}
        <box flexDirection="row" gap={1} marginTop={1}>
          <text fg={openTuiTheme.color.teal} selectable={false}>
            noQ
          </text>
          <text fg={openTuiTheme.color.lineStrong} selectable={false}>
            {'///'}
          </text>
        </box>
        <text fg={openTuiTheme.color.textMuted} truncate marginTop={1}>
          {truncateMiddle(props.sessionId, 22)}
        </text>
        <box backgroundColor={modeBadgeColor(props.mode)} paddingX={1} marginTop={1} width={7}>
          <text fg={openTuiTheme.color.canvas} selectable={false} truncate>
            {props.mode.toUpperCase()}
          </text>
        </box>
      </box>

      <box
        flexDirection="column"
        border={['bottom']}
        borderColor={openTuiTheme.color.line}
        paddingBottom={1}
      >
        {sectionLabel('Model')}
        <text fg={openTuiTheme.color.text} truncate marginTop={1}>
          {modelIdLabel(props.currentModelSelection)}
        </text>
        <text fg={openTuiTheme.color.textMuted} truncate>
          {modelProviderLabel(props.currentModelSelection)}
        </text>
      </box>

      <box flexDirection="column">
        {sectionLabel('Workspace')}
        <text fg={openTuiTheme.color.textSoft} truncate marginTop={1}>
          {truncateMiddle(props.workspacePath, 24)}
        </text>
      </box>
    </box>
  );
}
