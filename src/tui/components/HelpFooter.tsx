import React from 'react';
import { Text } from 'ink';

interface HelpFooterProps {
  text: string;
}

export function HelpFooter({ text }: HelpFooterProps): React.JSX.Element {
  return (
    <Text backgroundColor="white" color="black">
      {' '}
      {text}
      {' '}
    </Text>
  );
}
