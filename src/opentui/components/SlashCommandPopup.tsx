/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { openTuiTheme } from '../openTuiTheme';
import { type SlashCommandCatalogEntry } from '../slashCommands';

const maxVisibleRows = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getVisibleMatches(matches: SlashCommandCatalogEntry[], selectedIndex: number): SlashCommandCatalogEntry[] {
  if (matches.length <= maxVisibleRows) {
    return matches;
  }

  const safeSelectedIndex = clamp(selectedIndex, 0, matches.length - 1);
  const startIndex = clamp(
    safeSelectedIndex - Math.floor(maxVisibleRows / 2),
    0,
    matches.length - maxVisibleRows,
  );

  return matches.slice(startIndex, startIndex + maxVisibleRows);
}

function commandLabel(entry: SlashCommandCatalogEntry): string {
  return entry.argsHint ? `${entry.command} ${entry.argsHint}` : entry.command;
}

export function SlashCommandPopup(props: {
  matches: SlashCommandCatalogEntry[];
  selectedIndex: number;
  width: number;
}) {
  const popupWidth = () => Math.max(28, Math.min(props.width, 88));
  const visibleMatches = () => getVisibleMatches(props.matches, props.selectedIndex);
  const visibleSelectedIndex = () => {
    if (props.matches.length <= maxVisibleRows) {
      return clamp(props.selectedIndex, 0, Math.max(0, props.matches.length - 1));
    }

    const safeSelectedIndex = clamp(props.selectedIndex, 0, props.matches.length - 1);
    const startIndex = clamp(
      safeSelectedIndex - Math.floor(maxVisibleRows / 2),
      0,
      props.matches.length - maxVisibleRows,
    );

    return safeSelectedIndex - startIndex;
  };
  const commandColumnWidth = () => Math.max(12, Math.min(28, Math.floor(popupWidth() * 0.34)));

  return (
    <box
      position="absolute"
      left={3}
      bottom={3}
      zIndex={1}
      width={popupWidth()}
      border
      borderStyle="rounded"
      borderColor={openTuiTheme.color.lineStrong}
      focusedBorderColor={openTuiTheme.color.teal}
      backgroundColor={openTuiTheme.color.panelRaised}
      flexDirection="column"
      paddingY={0}
    >
      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        backgroundColor={openTuiTheme.color.rail}
      >
        <text fg={openTuiTheme.color.amber}>commands</text>
        <text fg={openTuiTheme.color.textFaint}>
          {`${Math.min(props.matches.length, maxVisibleRows)}/${props.matches.length}`}
        </text>
      </box>

      <For each={visibleMatches()}>
        {(entry, index) => {
          const isSelected = () => index() === visibleSelectedIndex();

          return (
            <box
              width="100%"
              flexDirection="row"
              gap={1}
              paddingX={1}
              backgroundColor={isSelected() ? openTuiTheme.color.teal : openTuiTheme.color.panelRaised}
            >
              <box width={commandColumnWidth()} flexShrink={0}>
                <text
                  fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.text}
                  truncate
                >
                  {commandLabel(entry)}
                </text>
              </box>
              <text
                fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textFaint}
                truncate
                flexGrow={1}
              >
                {entry.description}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
