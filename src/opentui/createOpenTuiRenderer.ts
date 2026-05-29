import { createCliRenderer, type CliRenderer } from '@opentui/core';

import { openTuiTheme } from './openTuiTheme';

export async function createOpenTuiRenderer(): Promise<CliRenderer> {
  return createCliRenderer({
    screenMode: 'alternate-screen',
    exitOnCtrlC: false,
    targetFps: 30,
    maxFps: 60,
    useMouse: true,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
    backgroundColor: openTuiTheme.color.canvas,
  });
}
