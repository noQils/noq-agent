import React from 'react';
import { Text } from 'ink';

import { tuiTheme } from '../theme';

interface HelpFooterProps {
  text: string;
}

export function HelpFooter({ text }: HelpFooterProps): React.JSX.Element {
  return (
    <Text
      backgroundColor={tuiTheme.helpFooter.background}
      color={tuiTheme.helpFooter.foreground}
    >
      {' '}
      {text}
      {' '}
    </Text>
  );
}
