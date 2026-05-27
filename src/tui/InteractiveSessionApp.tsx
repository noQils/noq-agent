import React, { useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

import { type AgentMode } from '../agentMode';
import { type SessionEntry } from './state';

type ScreenInputResult =
  | { kind: 'submit'; line: string }
  | { kind: 'exit' };

interface InteractiveSessionAppProps {
  sessionId: string;
  mode: AgentMode;
  entries: SessionEntry[];
  onFinish: (result: ScreenInputResult) => void;
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
  onFinish,
}: InteractiveSessionAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [inputValue, setInputValue] = useState('');
  const finishedRef = useRef(false);

  const visibleEntries = useMemo(() => getVisibleEntries(entries), [entries]);

  const finish = (result: ScreenInputResult): void => {
    if (finishedRef.current) {
      return;
    }

    finishedRef.current = true;
    onFinish(result);
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      finish({ kind: 'exit' });
      return;
    }

    if (key.escape) {
      finish({ kind: 'exit' });
      return;
    }

    if (key.return) {
      finish({
        kind: 'submit',
        line: inputValue,
      });
      return;
    }

    if (key.backspace || key.delete) {
      setInputValue((currentValue) => currentValue.slice(0, -1));
      return;
    }

    if (key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }

    if (input.length > 0) {
      setInputValue((currentValue) => currentValue + input);
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
        borderColor="green"
        paddingX={1}
        flexDirection="column"
        marginBottom={1}
      >
        <Text color="green">Message</Text>
        <Text>{`> ${inputValue}`}</Text>
      </Box>

      <Text backgroundColor="white" color="black">
        {' '}
        {buildHelpLine()}
        {' '}
      </Text>
    </Box>
  );
}
