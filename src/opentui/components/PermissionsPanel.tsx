/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { MacOSScrollAccel, type ScrollBoxRenderable } from '@opentui/core';

import { openTuiTheme } from '../openTuiTheme';
import { type OpenTuiPermissionItem } from '../openTuiTypes';

function formatScopeLabel(scope: OpenTuiPermissionItem['scope']): string {
  return scope.replaceAll('_', ' ');
}

function formatSourceLabel(source: OpenTuiPermissionItem['source']): string {
  if (source === 'workspace_rules') {
    return 'workspace rules';
  }

  return source;
}

function outcomeColor(outcome: OpenTuiPermissionItem['outcome']): string {
  if (outcome === 'allow') {
    return openTuiTheme.color.green;
  }

  if (outcome === 'deny') {
    return openTuiTheme.color.red;
  }

  return openTuiTheme.color.amber;
}

export function PermissionsPanel(props: {
  items: OpenTuiPermissionItem[];
  selectedIndex: number;
  onCycle: () => void;
  scrollRef: (scrollbox: ScrollBoxRenderable) => void;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  const selectedItem = () => props.items[props.selectedIndex] ?? props.items[0];

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={openTuiTheme.color.teal}
      focusedBorderColor={openTuiTheme.color.teal}
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      flexDirection="column"
      gap={1}
      width="100%"
      height="100%"
    >
      <box
        flexDirection="row"
        gap={1}
        width="100%"
        alignItems="center"
        flexShrink={0}
        paddingLeft={1}
        justifyContent="space-between"
      >
        <text fg={openTuiTheme.color.amber} flexShrink={1}>
          Session Permissions
        </text>
        <box backgroundColor={openTuiTheme.color.teal} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas}>
            {`${props.selectedIndex + 1}/${props.items.length}`}
          </text>
        </box>
      </box>

      <box
        width="100%"
        border={['left']}
        borderStyle="heavy"
        borderColor={openTuiTheme.color.teal}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
      >
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Scope</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={openTuiTheme.color.text} truncate flexGrow={1}>
              {selectedItem() ? formatScopeLabel(selectedItem()!.scope) : '(none)'}
            </text>
            <text fg={openTuiTheme.color.ghost} truncate flexGrow={1}>
              {selectedItem()?.scopeDescription ?? '(none)'}
            </text>
          </box>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Value</text>
          </box>
          <text fg={selectedItem() ? outcomeColor(selectedItem()!.outcome) : openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {selectedItem()?.outcome ?? '(none)'}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Source</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {selectedItem() ? formatSourceLabel(selectedItem()!.source) : '(none)'}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Rule</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {selectedItem()?.description ?? '(none)'}
          </text>
        </box>
      </box>

      <box
        width="100%"
        paddingX={1}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
      >
        <scrollbox
          ref={props.scrollRef}
          width="100%"
          flexGrow={1}
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
          <box width="100%" flexDirection="column">
            <For each={props.items}>
              {(item, index) => {
                const isSelected = () => index() === props.selectedIndex;
                return (
                  <box
                    width="100%"
                    paddingX={1}
                    paddingY={0}
                    backgroundColor={isSelected() ? openTuiTheme.color.panelRaised : openTuiTheme.color.canvas}
                    onMouseDown={() => props.onCycle()}
                  >
                    <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                      <text fg={isSelected() ? openTuiTheme.color.text : openTuiTheme.color.textSoft} truncate flexGrow={1}>
                        {formatScopeLabel(item.scope)}
                      </text>
                      <text fg={outcomeColor(item.outcome)} flexShrink={0}>
                        {item.outcome}
                      </text>
                      <text fg={openTuiTheme.color.textFaint} flexShrink={0}>
                        {formatSourceLabel(item.source)}
                      </text>
                    </box>
                  </box>
                );
              }}
            </For>
          </box>
        </scrollbox>
      </box>

      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0}>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.cyan}>↑/↓</text>
          <text fg={openTuiTheme.color.textMuted}>move</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.cyan}>enter</text>
          <text fg={openTuiTheme.color.textMuted}>cycle ask/allow/deny</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={openTuiTheme.color.cyan}>esc</text>
          <text fg={openTuiTheme.color.textMuted}>close</text>
        </box>
      </box>
    </box>
  );
}
