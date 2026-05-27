import React from 'react';
import { withFullScreen } from 'fullscreen-ink';
import { stdin as input, stdout as output } from 'node:process';

import { type Instance } from 'ink';

export interface FullscreenRendererHandle {
  instance: Instance;
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
}

export function createFullscreenRenderer(
  tree: React.ReactElement,
): FullscreenRendererHandle {
  const fullscreenApp = withFullScreen(tree, {
    stdin: input,
    stdout: output,
    exitOnCtrlC: false,
  });

  fullscreenApp.start();

  return {
    instance: fullscreenApp.instance,
    rerender(nextTree) {
      fullscreenApp.instance.rerender(nextTree);
    },
    unmount() {
      fullscreenApp.instance.unmount();
    },
  };
}
