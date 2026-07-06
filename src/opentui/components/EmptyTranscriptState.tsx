/** @jsxImportSource @opentui/solid */

import { openTuiTheme } from '../openTuiTheme';
import { NoqLogo } from './NoqLogo';

export function EmptyTranscriptState(props: { isCompact: boolean }) {
  return (
    <box
      flexGrow={1}
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      gap={1}
      justifyContent="center"
      alignItems="center"
    >
      <box flexDirection="row" gap={1}>
        <NoqLogo />
      </box>
      {props.isCompact ? (
        <text
          fg={openTuiTheme.color.textMuted}
          selectable
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
        >
          Type a message to begin.
        </text>
      ) : (
        <>
          <text
            fg={openTuiTheme.color.text}
            selectable
            selectionBg={openTuiTheme.color.selectionBg}
            selectionFg={openTuiTheme.color.selectionFg}
          >
            What shall we build today?
          </text>
          <text
            fg={openTuiTheme.color.textMuted}
            wrapMode="word"
            selectable
            selectionBg={openTuiTheme.color.selectionBg}
            selectionFg={openTuiTheme.color.selectionFg}
          >
            Send a prompt below, or use /permissions, /connect, /model, /diff, /plan show, /undo, and /exit.
          </text>
        </>
      )}
    </box>
  );
}
