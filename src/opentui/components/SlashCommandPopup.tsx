/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { openTuiTheme } from '../openTuiTheme';
import { type SlashCommandCatalogEntry } from '../slashCommands';

const maxVisibleRows = 10;

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
  isMediumTall: boolean;
  isVeryTall: boolean;
}) {
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
  const slashMenuBottomMargin = () => (props.isVeryTall ? 8 : props.isMediumTall ? 7 : 6);

  return (
    <box
      position="absolute"
      left={2}
      right={0}
      bottom={slashMenuBottomMargin()}
      zIndex={1}
      border={["left", "right"]}
      borderStyle="heavy"
      borderColor={openTuiTheme.color.lineStrong}
      backgroundColor={openTuiTheme.color.canvas}
      flexDirection="column"
      paddingY={0}
      overflow="hidden"
    >
      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        paddingX={1}
        backgroundColor={openTuiTheme.color.rail}
      >
        <text fg={openTuiTheme.color.amber}>commands</text>
      </box>

      <For each={visibleMatches()}>
        {(entry, index) => {
          const isSelected = () => index() === visibleSelectedIndex();

          return (
            <box
              width="100%"
              height={1}
              minHeight={1}
              maxHeight={1}
              flexDirection="row"
              gap={1}
              paddingX={1}
              backgroundColor={isSelected() ? openTuiTheme.color.teal : openTuiTheme.color.canvas}
            >
              <box width={30} height={1}>
                <text
                  fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.text}
                  truncate
                >
                  {commandLabel(entry)}
                </text>
              </box>
              <box height={1} flexGrow={1}>
                <text
                  fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textFaint}
                  truncate
                >
                  {entry.description}
                </text>
              </box>
            </box>
          );
        }}
      </For>
    </box>
  );
}
