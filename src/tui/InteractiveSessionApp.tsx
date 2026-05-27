import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';

import { type AgentMode } from '../agentMode';
import { type SessionEntry } from './state';

interface InteractiveSessionAppProps {
  sessionId: string;
  mode: AgentMode;
  entries: SessionEntry[];
  inputValue: string;
  isBusy: boolean;
  onInputValueChange: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}

function buildStatusLine(sessionId: string, mode: AgentMode): string {
  return `Session: ${sessionId} | Mode: ${mode}`;
}

function buildHelpLine(): string {
  return '/mode plan | /mode build | /plan show | /diff | /undo | /exit';
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

function getVisibleEntries(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) {
    return [];
  }

  return entries.slice(-12);
}

export function InteractiveSessionApp({
  sessionId,
  mode,
  entries,
  inputValue,
  isBusy,
  onInputValueChange,
  onSubmit,
  onExit,
}: InteractiveSessionAppProps): React.JSX.Element {
  const visibleEntries = useMemo(() => getVisibleEntries(entries), [entries]);

  useInput((input, key) => {
    if (isBusy) {
      if (key.ctrl && input === 'c') {
        onExit();
      }

      return;
    }

    if (key.ctrl && input === 'c') {
      onExit();
      return;
    }

    if (key.escape) {
      onExit();
      return;
    }

    if (key.return) {
      onSubmit();
      return;
    }

    if (key.backspace || key.delete) {
      onInputValueChange(inputValue.slice(0, -1));
      return;
    }

    if (key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }

    if (input.length > 0) {
      onInputValueChange(inputValue + input);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text backgroundColor="cyan" color="black">
          {' '}
          {buildStatusLine(sessionId, mode)}
          {' '}
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        paddingY={0}
        marginBottom={1}
      >
        <Text color="cyan">Conversation</Text>
        {visibleEntries.length === 0 ? (
          <Text color="gray">Conversation started. Type a message or use /exit to leave the session.</Text>
        ) : (
          visibleEntries.map((entry, index) => (
            <Box key={`${entry.kind}-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
              <Text color={getEntryColor(entry.kind)}>{formatEntryLabel(entry.kind)}</Text>
              <Text>{entry.text}</Text>
            </Box>
          ))
        )}
      </Box>

      <Box
        borderStyle="round"
        borderColor={isBusy ? 'yellow' : 'green'}
        paddingX={1}
        flexDirection="column"
        marginBottom={1}
      >
        <Text color={isBusy ? 'yellow' : 'green'}>{isBusy ? 'Working' : 'Message'}</Text>
        <Text>{isBusy ? 'Waiting for the current turn to finish...' : `> ${inputValue}`}</Text>
      </Box>

      <Text backgroundColor="white" color="black">
        {' '}
        {buildHelpLine()}
        {' '}
      </Text>
    </Box>
  );
}
