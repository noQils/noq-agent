import React from 'react';
import { Box, Text } from 'ink';

import { tuiTheme } from '../theme';

interface StatusBarProps {
  text: string;
}

export function StatusBar({ text }: StatusBarProps): React.JSX.Element {
  return (
    <Box marginBottom={tuiTheme.layout.sectionMarginBottom}>
      <Text
        backgroundColor={tuiTheme.statusBar.background}
        color={tuiTheme.statusBar.foreground}
      >
        {' '}
        {text}
        {' '}
      </Text>
    </Box>
  );
}
