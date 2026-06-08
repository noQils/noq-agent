/** @jsxImportSource @opentui/solid */

import { type TextareaRenderable } from '@opentui/core';

import { openTuiTheme } from '../openTuiTheme';

function estimateWrappedLineCount(value: string, availableWidth: number): number {
  const normalizedWidth = Math.max(1, availableWidth);
  const lines = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

  return lines.reduce((count, line) => {
    const lineLength = Math.max(1, line.length);
    return count + Math.max(1, Math.ceil(lineLength / normalizedWidth));
  }, 0);
}

export function Composer(props: {
  inputValue: string;
  isBusy: boolean;
  hasModalOverlay: boolean;
  isNarrow: boolean;
  isCompact: boolean;
  isMediumTall: boolean;
  isVeryTall: boolean;
  width: number;
  onInput: (value: string) => void;
  onSubmit: () => void;
  textareaRef: (textarea: TextareaRenderable) => void;
}) {
  const composerTextWidth = () => Math.max(12, props.width - 8);
  const composerLineCount = () => estimateWrappedLineCount(props.inputValue, composerTextWidth());
  const composerMaxVisibleLines = () => (props.isCompact ? 4 : 8);
  const composerVisibleLines = () => {
    if (props.isVeryTall) {
      return Math.min(composerMaxVisibleLines(), Math.max(3, composerLineCount()));
    }

    if (props.isMediumTall) {
      return Math.min(composerMaxVisibleLines(), Math.max(2, composerLineCount()));
    }

    return Math.min(composerMaxVisibleLines(), Math.max(1, composerLineCount()));
  };
  const composerFrameHeight = () => Math.max(3, composerVisibleLines() + 2);
  const borderColor = () => (
    props.isBusy ? openTuiTheme.color.amberSoft : openTuiTheme.color.teal
  );
  const focusedBorderColor = () => (
    props.isBusy ? openTuiTheme.color.amber : openTuiTheme.color.teal
  );
  const placeholder = () => {
    if (props.isBusy) {
      return props.isNarrow ? 'Waiting...' : 'Waiting for the current turn to finish...';
    }

    return 'Type here...';
  };

  let textareaRef: TextareaRenderable | null = null;

  return (
    <box
      paddingLeft={1}
      paddingRight={3}
      paddingY={0}
      minHeight={composerFrameHeight()}
      height={composerFrameHeight()}
      flexDirection="row"
      alignItems="flex-start"
    >
      <box width={2} flexShrink={0} paddingTop={0}>
        <text fg={props.isBusy ? openTuiTheme.color.amber : openTuiTheme.color.teal} selectable={false}>
          {'>'}
        </text>
      </box>
      <textarea
        ref={(textarea) => {
          textareaRef = textarea;
          props.textareaRef(textarea);
          textareaRef.setText(props.inputValue);
        }}
        initialValue={props.inputValue}
        placeholder={placeholder()}
        focused={!props.isBusy && !props.hasModalOverlay}
        flexGrow={1}
        height={composerVisibleLines()}
        wrapMode="word"
        textColor={openTuiTheme.color.text}
        focusedTextColor={openTuiTheme.color.text}
        placeholderColor={openTuiTheme.color.textFaint}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        selectionBg={openTuiTheme.color.selectionBg}
        selectionFg={openTuiTheme.color.selectionFg}
        keyBindings={[
          { name: 'return', action: 'submit' },
          { name: 'kpenter', action: 'submit' },
          { name: 'linefeed', action: 'submit' },
          { name: 'return', shift: true, action: 'newline' },
          { name: 'kpenter', shift: true, action: 'newline' },
          { name: 'o', ctrl: true, action: 'newline' },
        ]}
        onContentChange={() => {
          if (!props.hasModalOverlay) {
            props.onInput(textareaRef?.plainText ?? '');
          }
        }}
        onSubmit={() => {
          if (!props.hasModalOverlay) {
            props.onSubmit();
          }
        }}
      />
    </box>
  );
}
