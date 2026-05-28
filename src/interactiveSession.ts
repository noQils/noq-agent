import { spawn } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';

import { type AgentMode } from './agentMode';
import { buildOpenTuiBunArgs, type OpenTuiLaunchOptions } from './openTuiLaunchPaths';

export type InteractiveSessionOptions = OpenTuiLaunchOptions;

export async function startInteractiveSession(
  sessionId: string | undefined,
  initialMode: AgentMode,
  options?: InteractiveSessionOptions,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'bun',
      buildOpenTuiBunArgs(sessionId, initialMode, options),
      {
        cwd: process.cwd(),
        stdio: 'inherit',
        windowsHide: false,
      },
    );

    child.once('error', (error) => {
      reject(new Error(`Failed to launch the OpenTUI session with Bun: ${error.message}`));
    });

    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`The OpenTUI session exited unexpectedly with signal ${signal}.`));
        return;
      }

      if (code && code !== 0) {
        reject(new Error(`The OpenTUI session exited with code ${code}.`));
        return;
      }

      resolve();
    });
  });
}
