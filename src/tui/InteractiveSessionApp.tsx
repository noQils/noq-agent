import React, { useMemo } from 'react';
import { Box, useInput } from 'ink';

import { Composer } from './components/Composer';
import { HelpFooter } from './components/HelpFooter';
import { StatusBar } from './components/StatusBar';
import { type InteractiveSessionViewModel } from './state';
import { TranscriptPane } from './components/TranscriptPane';

interface InteractiveSessionAppProps {
  viewModel: InteractiveSessionViewModel;
  inputValue: string;
  isBusy: boolean;
  onInputValueChange: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}

export function InteractiveSessionApp({
  viewModel,
  inputValue,
  isBusy,
  onInputValueChange,
  onSubmit,
  onExit,
}: InteractiveSessionAppProps): React.JSX.Element {
  const visibleEntries = useMemo(() => viewModel.entries.slice(-12), [viewModel.entries]);

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
      <StatusBar text={viewModel.statusText} />
      <TranscriptPane entries={visibleEntries} emptyStateText={viewModel.emptyStateText} />
      <Composer
        label={viewModel.inputLabel}
        text={viewModel.inputText}
        borderColor={viewModel.inputBorderColor}
        labelColor={viewModel.inputLabelColor}
      />
      <HelpFooter text={viewModel.helpText} />
    </Box>
  );
}
