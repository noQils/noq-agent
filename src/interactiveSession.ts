import { spawn } from 'node:child_process';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

import { type AgentMode } from './agentMode';

export interface InteractiveSessionOptions {
  restoreStoredMode?: boolean;
}

function getOpenTuiEntrypoint(): string {
  return path.join(process.cwd(), 'src', 'opentui', 'index.tsx');
}

function buildOpenTuiArgs(
  sessionId: string,
  mode: AgentMode,
  options?: InteractiveSessionOptions,
): string[] {
  const args = [
    'run',
    getOpenTuiEntrypoint(),
    '--session',
    sessionId,
    '--mode',
    mode,
  ];

  if (options?.restoreStoredMode) {
    args.push('--restore-mode');
  }

  return args;
}

export async function startInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
  options?: InteractiveSessionOptions,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'bun',
      buildOpenTuiArgs(sessionId, initialMode, options),
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
