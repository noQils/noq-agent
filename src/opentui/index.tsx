/** @jsxImportSource @opentui/solid */

import { render } from '@opentui/solid';

import { OpenTuiShell } from './OpenTuiShell';
import { createOpenTuiRenderer } from './createOpenTuiRenderer';

async function main(): Promise<void> {
  const renderer = await createOpenTuiRenderer();

  try {
    await render(() => <OpenTuiShell />, renderer);
  } catch (error) {
    renderer.destroy();
    throw error;
  }
}

void main().catch((error) => {
  console.error('Failed to start the OpenTUI shell:', error);
  process.exitCode = 1;
});
