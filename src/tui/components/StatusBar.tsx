import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  text: string;
}

export function StatusBar({ text }: StatusBarProps): React.JSX.Element {
  return (
    <Box marginBottom={1}>
      <Text backgroundColor="cyan" color="black">
        {' '}
        {text}
        {' '}
      </Text>
    </Box>
  );
}
