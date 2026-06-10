/** @jsxImportSource @opentui/solid */

import os from 'node:os';
import path from 'node:path';

import { MacOSScrollAccel } from '@opentui/core';

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

function formatWorkspacePath(workspacePath: string): string {
  const normalizedWorkspacePath = path.resolve(workspacePath);
  const homePath = path.resolve(os.homedir());
  const relativeToHome = path.relative(homePath, normalizedWorkspacePath);

  if (relativeToHome.length === 0) {
    return '~';
  }

  if (!relativeToHome.startsWith('..') && !path.isAbsolute(relativeToHome)) {
    return `~\\${relativeToHome}`;
  }

  return normalizedWorkspacePath;
}

const fullAsciiLogo = `
████████╗ ██████╗  ██████╗
██╔═══██║██╔═══██╗██╔═══██╗
██║   ██║██║   ██║██║   ██║
██║   ██║╚██████╔╝╚██████╔╝
╚═╝   ╚═╝ ╚═════╝  ╚══▀█▄╗
                       ╚═╝
`;

export function SessionSidebar(props: {
  sessionId: string;
  mode: AgentMode;
  currentModelSelection: OpenTuiCurrentModelSelection;
  workspacePath: string;
  isShort: boolean;
  isVeryShort: boolean;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  const sectionGap = () => props.isShort ? 0 : 1;
  const sectionSpacing = () => props.isShort ? 0 : 1;
  const sessionIdLabel = () => truncateMiddle(props.sessionId, props.isShort ? 26 : 30);
  const modelLabel = () => modelIdLabel(props.currentModelSelection);
  const providerLabel = () => `via ${modelProviderLabel(props.currentModelSelection)}`;
  const workspaceLabel = () => formatWorkspacePath(props.workspacePath);

  const sidebarContent = () => (
    <box
      width="100%"
      flexDirection="column"
      gap={sectionGap()}
      paddingBottom={props.isVeryShort ? 1 : 0}
    >
      <box flexDirection="column" flexShrink={0}>
        <text fg={openTuiTheme.color.teal} selectable={false}>
          {fullAsciiLogo}
        </text>
      </box>

      <box backgroundColor={modeBadgeColor(props.mode)} paddingX={1} width={7} flexShrink={0}>
        <text fg={openTuiTheme.color.canvas} selectable={false} truncate>
          {props.mode.toUpperCase()}
        </text>
      </box>

      <box flexDirection="column" flexShrink={0} marginTop={sectionSpacing()}>
        {sectionLabel('Session ID')}
        <text fg={openTuiTheme.color.textSoft} truncate>
          {sessionIdLabel()}
        </text>
      </box>

      <box flexDirection="column" flexShrink={props.isShort ? 1 : 0} marginTop={sectionSpacing()}>
        {sectionLabel('Model')}
        <text fg={openTuiTheme.color.text} wrapMode="word">
          {modelLabel()}
        </text>
        <text fg={openTuiTheme.color.ghost} wrapMode="word">
          {providerLabel()}
        </text>
      </box>

      <box flexDirection="column" flexShrink={1} marginTop={sectionSpacing()}>
        {sectionLabel('Workspace')}
        <text fg={openTuiTheme.color.textSoft} wrapMode="word">
          {workspaceLabel()}
        </text>
      </box>
    </box>
  );

  return (
    <box
      width="100%"
      height="100%"
      minHeight={0}
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      backgroundColor={openTuiTheme.color.canvas}
      flexShrink={0}
      gap={0}
    >
      {props.isVeryShort ? (
        <scrollbox
          width="100%"
          flexGrow={1}
          minHeight={0}
          scrollY
          scrollAcceleration={scrollAcceleration}
          backgroundColor={openTuiTheme.color.canvas}
          contentOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          viewportOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          scrollbarOptions={{
            trackOptions: {
              backgroundColor: openTuiTheme.color.canvas,
              foregroundColor: openTuiTheme.color.panelRaised,
            },
          }}
        >
          {sidebarContent()}
        </scrollbox>
      ) : sidebarContent()}
    </box>
  );
}
