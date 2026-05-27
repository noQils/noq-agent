import { createCliRenderer, type CliRenderer } from '@opentui/core';

export async function createOpenTuiRenderer(): Promise<CliRenderer> {
  return createCliRenderer({
    screenMode: 'alternate-screen',
    exitOnCtrlC: false,
    targetFps: 30,
    maxFps: 60,
    useMouse: true,
    backgroundColor: '#0d1117',
  });
}
