import React from 'react';
import { Box, Text } from 'ink';

import { tuiTheme } from '../theme';

interface ComposerProps {
  label: string;
  text: string;
  tone: 'idle' | 'busy';
}

export function Composer({
  label,
  text,
  tone,
}: ComposerProps): React.JSX.Element {
  const toneTheme = tuiTheme.composer[tone];

  return (
    <Box
      borderStyle="round"
      borderColor={toneTheme.borderColor}
      paddingX={tuiTheme.layout.panelPaddingX}
      flexDirection="column"
      marginBottom={tuiTheme.layout.sectionMarginBottom}
    >
      <Text color={toneTheme.labelColor}>{label}</Text>
      <Text>{text}</Text>
    </Box>
  );
}
