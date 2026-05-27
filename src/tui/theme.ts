export const tuiTheme = {
  layout: {
    rootPaddingX: 1,
    sectionMarginBottom: 1,
    panelPaddingX: 1,
    panelPaddingY: 0,
    transcriptEntryGap: 1,
  },
  statusBar: {
    foreground: 'black',
    background: 'cyan',
  },
  transcript: {
    borderColor: 'cyan',
    headingColor: 'cyan',
    emptyStateColor: 'gray',
    userColor: 'cyan',
    assistantColor: 'green',
    systemColor: 'yellow',
  },
  composer: {
    idle: {
      borderColor: 'green',
      labelColor: 'green',
    },
    busy: {
      borderColor: 'yellow',
      labelColor: 'yellow',
    },
    permission: {
      borderColor: 'magenta',
      labelColor: 'magenta',
    },
  },
  helpFooter: {
    foreground: 'black',
    background: 'white',
  },
} as const;
