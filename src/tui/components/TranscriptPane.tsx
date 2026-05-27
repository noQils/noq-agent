import React from 'react';
import { Box, Text } from 'ink';

import { type SessionEntry } from '../state';
import { tuiTheme } from '../theme';

interface TranscriptPaneProps {
  entries: SessionEntry[];
  emptyStateText: string;
}

function formatEntryLabel(kind: SessionEntry['kind']): string {
  if (kind === 'user') {
    return 'You';
  }

  if (kind === 'assistant') {
    return 'Agent';
  }

  return 'System';
}

function getEntryColor(kind: SessionEntry['kind']): string {
  if (kind === 'user') {
    return tuiTheme.transcript.userColor;
  }

  if (kind === 'assistant') {
    return tuiTheme.transcript.assistantColor;
  }

  return tuiTheme.transcript.systemColor;
}

export function TranscriptPane({
  entries,
  emptyStateText,
}: TranscriptPaneProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tuiTheme.transcript.borderColor}
      paddingX={tuiTheme.layout.panelPaddingX}
      paddingY={tuiTheme.layout.panelPaddingY}
      marginBottom={tuiTheme.layout.sectionMarginBottom}
    >
      <Text color={tuiTheme.transcript.headingColor}>Conversation</Text>
      {entries.length === 0 ? (
        <Text color={tuiTheme.transcript.emptyStateColor}>{emptyStateText}</Text>
      ) : (
        entries.map((entry, index) => (
          <Box
            key={`${entry.kind}-${index}`}
            flexDirection="column"
            marginTop={index === 0 ? 0 : tuiTheme.layout.transcriptEntryGap}
          >
            <Text color={getEntryColor(entry.kind)}>{formatEntryLabel(entry.kind)}</Text>
            <Text>{entry.text}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
