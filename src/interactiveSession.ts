import { spawn } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';

import { type AgentMode } from './agentMode';
import { buildInternalOpenTuiArgs, resolveRuntimeLaunchSpec } from './runtimeLaunch';

export interface InteractiveSessionOptions {
  restoreStoredMode?: boolean;
  cwd?: string;
}

export async function startInteractiveSession(
  sessionId: string | undefined,
  initialMode: AgentMode,
  options?: InteractiveSessionOptions,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  const runtimeLaunch = resolveRuntimeLaunchSpec();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      runtimeLaunch.command,
      [
        ...runtimeLaunch.args,
        ...buildInternalOpenTuiArgs(sessionId, initialMode, options),
      ],
      {
        cwd: options?.cwd ?? process.cwd(),
        stdio: 'inherit',
        windowsHide: false,
      },
    );

    child.once('error', (error) => {
      reject(new Error(`Failed to launch the OpenTUI session: ${error.message}`));
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
