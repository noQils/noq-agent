declare module 'fullscreen-ink' {
  import type React from 'react';
  import type { Instance, RenderOptions } from 'ink';

  export interface FullScreenInkController {
    instance: Instance;
    start(): void;
  }

  export function withFullScreen(
    tree: React.ReactElement,
    options?: RenderOptions,
  ): FullScreenInkController;
}
