import React from 'react';
import { Box, Text } from 'ink';

import { type SessionEntry } from '../state';

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
    return 'cyan';
  }

  if (kind === 'assistant') {
    return 'green';
  }

  return 'yellow';
}

export function TranscriptPane({
  entries,
  emptyStateText,
}: TranscriptPaneProps): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Text color="cyan">Conversation</Text>
      {entries.length === 0 ? (
        <Text color="gray">{emptyStateText}</Text>
      ) : (
        entries.map((entry, index) => (
          <Box key={`${entry.kind}-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text color={getEntryColor(entry.kind)}>{formatEntryLabel(entry.kind)}</Text>
            <Text>{entry.text}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
