import React from 'react';
import { stdin as input, stdout as output } from 'node:process';

import { render, type Instance } from 'ink';

const ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
const EXIT_ALTERNATE_SCREEN = '\u001B[?1049l';
const CLEAR_SCREEN = '\u001B[2J';
const CURSOR_HOME = '\u001B[H';

export interface FullscreenRendererHandle {
  instance: Instance;
  rerender: (tree: React.ReactElement) => void;
  unmount: () => void;
}

export function createFullscreenRenderer(
  tree: React.ReactElement,
): FullscreenRendererHandle {
  output.write(ENTER_ALTERNATE_SCREEN);
  output.write(CLEAR_SCREEN);
  output.write(CURSOR_HOME);

  const instance = render(tree, {
    stdin: input,
    stdout: output,
    exitOnCtrlC: false,
  });
  let isUnmounted = false;

  return {
    instance,
    rerender(nextTree) {
      if (isUnmounted) {
        return;
      }

      instance.rerender(nextTree);
    },
    unmount() {
      if (isUnmounted) {
        return;
      }

      isUnmounted = true;
      instance.unmount();
      output.write(EXIT_ALTERNATE_SCREEN);
    },
  };
}
