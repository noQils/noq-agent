/** @jsxImportSource @opentui/solid */

import path from 'node:path';

import { Dynamic, extend } from '@opentui/solid';
import { DiffRenderable, MacOSScrollAccel, type ScrollBoxRenderable } from '@opentui/core';

import { getOpenTuiDiffSyntaxStyle, openTuiTheme, truncateMiddle } from '../openTuiTheme';
import { type OpenTuiDiffModalState } from '../openTuiTypes';

extend({ diff: DiffRenderable });

const diffComponent: any = 'diff';

function formatToolLabel(state: OpenTuiDiffModalState): string {
  return state.toolName ?? state.mutationKind ?? 'diff';
}

function getPathLabel(filePath: string | undefined): string {
  if (!filePath) {
    return '~/(latest snapshot)';
  }

  const normalizedPath = filePath.replaceAll('\\', '/');
  const directoryPath = path.posix.dirname(normalizedPath);
  return directoryPath === '.' ? '~/' : `~/${directoryPath}`;
}

function getFileLabel(filePath: string | undefined): string {
  if (!filePath) {
    return '(multiple files)';
  }

  return filePath.replaceAll('\\', '/');
}

export function ShowDiffPanel(props: {
  state: OpenTuiDiffModalState;
  targetMaxLength: number;
  previewScrollRef: (scrollbox: ScrollBoxRenderable) => void;
}) {
  const previewScrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  const detailLabelWidth = 4;

  return (
    <box
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
          Latest Session Diff
        </text>
        <box backgroundColor={openTuiTheme.color.amber} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas} truncate>
            {formatToolLabel(props.state).toUpperCase()}
          </text>
        </box>
      </box>

      <box
        width="100%"
        border={['left']}
        borderStyle="heavy"
        borderColor={openTuiTheme.color.amber}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
      >
        <box flexDirection="row" gap={1}>
          <box width={detailLabelWidth} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Tool</text>
          </box>
          <text fg={openTuiTheme.color.text} truncate flexGrow={1}>
            {formatToolLabel(props.state)}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={detailLabelWidth} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Path</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {truncateMiddle(getPathLabel(props.state.filePath), props.targetMaxLength)}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={detailLabelWidth} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>File</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {truncateMiddle(getFileLabel(props.state.filePath), props.targetMaxLength)}
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
        title="latest diff"
        titleAlignment="left"
      >
        <scrollbox
          ref={props.previewScrollRef}
          width="100%"
          flexGrow={1}
          scrollX
          scrollY
          scrollAcceleration={previewScrollAcceleration}
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
          horizontalScrollbarOptions={{
            trackOptions: {
              backgroundColor: openTuiTheme.color.canvas,
              foregroundColor: openTuiTheme.color.panelRaised,
            },
          }}
        >
          <Dynamic
            component={diffComponent}
            diff={props.state.diffText}
            filetype={props.state.filetype}
            view="unified"
            fg={openTuiTheme.color.textSoft}
            syntaxStyle={getOpenTuiDiffSyntaxStyle()}
            wrapMode="none"
            showLineNumbers
            lineNumberFg={openTuiTheme.color.textMuted}
            lineNumberBg={openTuiTheme.color.canvas}
            addedLineNumberBg={openTuiTheme.color.diffAddedBg}
            removedLineNumberBg={openTuiTheme.color.diffRemovedBg}
            addedBg={openTuiTheme.color.diffAddedBg}
            removedBg={openTuiTheme.color.diffRemovedBg}
            contextBg={openTuiTheme.color.canvas}
            addedContentBg={openTuiTheme.color.diffAddedContentBg}
            removedContentBg={openTuiTheme.color.diffRemovedContentBg}
            contextContentBg={openTuiTheme.color.canvas}
            addedSignColor={openTuiTheme.color.green}
            removedSignColor={openTuiTheme.color.red}
            selectionBg={openTuiTheme.color.selectionBg}
            selectionFg={openTuiTheme.color.selectionFg}
          />
        </scrollbox>
      </box>

      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0}>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.teal}>esc</text>
          <text fg={openTuiTheme.color.textMuted}>close</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={openTuiTheme.color.teal}>shift+↑/↓</text>
          <text fg={openTuiTheme.color.textMuted}>scroll diff</text>
        </box>
      </box>
    </box>
  );
}
