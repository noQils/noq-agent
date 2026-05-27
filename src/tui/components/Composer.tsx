import React from 'react';
import { Box, Text } from 'ink';

interface ComposerProps {
  label: string;
  text: string;
  borderColor: string;
  labelColor: string;
}

export function Composer({
  label,
  text,
  borderColor,
  labelColor,
}: ComposerProps): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      flexDirection="column"
      marginBottom={1}
    >
      <Text color={labelColor}>{label}</Text>
      <Text>{text}</Text>
    </Box>
  );
}
