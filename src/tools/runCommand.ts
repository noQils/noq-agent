import { spawn } from 'node:child_process';

import { isHardBlockedCommand, normalizeCommand } from '../commandPolicy';
import { checkIsDirectory } from '../fileUtils';
import { debugLog } from '../config/runtimeSettings';
import { InternalTool } from './index';

const maxOutputLength = 6000;
const maxCapturedOutputLength = 20000;
const commandTimeoutMs = 120_000;

function stringifyCommandOutput(value: unknown): string {
  if (!value) {
    return '';
  }

  return Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
}

function truncateOutput(output: string): string {
  return output.length > maxOutputLength
    ? `${output.slice(0, maxOutputLength)}\n... output truncated ...`
    : output;
}

function buildCommandFailureDetails(details: {
  code?: number | null;
  message?: string;
  signal?: NodeJS.Signals | null;
  stderr?: string;
  stdout?: string;
}): string {
  const parts = [
    typeof details.code === 'number' ? `exit status: ${details.code}` : '',
    details.signal ? `signal: ${String(details.signal)}` : '',
    details.stdout?.trim() ?? '',
    details.stderr?.trim() ?? '',
    details.message?.trim() ?? '',
  ].filter(Boolean);

  return truncateOutput(Array.from(new Set(parts)).join('\n'));
}

function appendOutputChunk(currentOutput: string, chunk: string): string {
  if (!chunk || currentOutput.length >= maxCapturedOutputLength) {
    return currentOutput;
  }

  const remainingLength = maxCapturedOutputLength - currentOutput.length;
  return currentOutput + chunk.slice(0, remainingLength);
}

export const runCommandTool: InternalTool = {
  name: 'run_command',
  description: 'Run a shell command and return the output. Commands are controlled by the permission policy, and catastrophic commands are always blocked.',
  allowedModes: ['build'],
  permission: {
    scope: 'bash',
    getTarget: (args) => typeof args.command === 'string' ? normalizeCommand(args.command) : '',
  },
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to run',
        required: true,
      },
      cwd: {
        type: 'string',
        description: 'The working directory to run the command in',
        nullable: true,
      },
    },
  },

  execute: (args: { command: string; cwd?: string }) => runCommand(args.command, args.cwd),
};

export async function runCommand(command: string, cwd?: string): Promise<string> {
  const startedAt = Date.now();
  const trimmedCommand = command.trim();
  const normalizedCommand = normalizeCommand(command);
  if (!trimmedCommand) {
    throw new Error('Command cannot be empty.');
  }

  if (isHardBlockedCommand(normalizedCommand)) {
    debugLog('Command blocked by hard safety policy:', { command: trimmedCommand });
    throw new Error(`Dangerous command is not allowed: ${trimmedCommand}`);
  }

  if (cwd && !checkIsDirectory(cwd)) {
    throw new Error(`${cwd} is not a directory`);
  }

  return new Promise<string>((resolve, reject) => {
    debugLog('Command starting:', {
      command: trimmedCommand,
      cwd: cwd ?? process.cwd(),
      timeoutMs: commandTimeoutMs,
    });
    const child = spawn(trimmedCommand, [], {
      cwd: cwd ?? process.cwd(),
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      debugLog('Command timeout reached; killing child process:', {
        command: trimmedCommand,
        timeoutMs: commandTimeoutMs,
      });
      child.kill();
    }, commandTimeoutMs);

    function finish(callback: () => void): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      callback();
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = appendOutputChunk(stdout, stringifyCommandOutput(chunk));
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = appendOutputChunk(stderr, stringifyCommandOutput(chunk));
    });

    child.on('error', (error) => {
      finish(() => {
        debugLog('Command process error:', {
          command: trimmedCommand,
          durationMs: Date.now() - startedAt,
          error: error.message,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        });
        reject(new Error(
          `Command ${trimmedCommand} failed:\n${buildCommandFailureDetails({
            message: error.message,
            stderr,
            stdout,
          })}`,
        ));
      });
    });

    child.on('close', (code, signal) => {
      finish(() => {
        if (timedOut) {
          debugLog('Command failed after timeout:', {
            command: trimmedCommand,
            durationMs: Date.now() - startedAt,
            code,
            signal,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          reject(new Error(
            `Command ${trimmedCommand} failed:\n${buildCommandFailureDetails({
              message: `Timed out after ${commandTimeoutMs}ms.`,
              code,
              signal,
              stderr,
              stdout,
            })}`,
          ));
          return;
        }

        if (code !== 0) {
          debugLog('Command failed:', {
            command: trimmedCommand,
            durationMs: Date.now() - startedAt,
            code,
            signal,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
          });
          reject(new Error(
            `Command ${trimmedCommand} failed:\n${buildCommandFailureDetails({
              code,
              signal,
              stderr,
              stdout,
            })}`,
          ));
          return;
        }

        const combinedOutput = [stdout.trimEnd(), stderr.trimEnd()]
          .filter(Boolean)
          .join('\n');
        const output = truncateOutput(combinedOutput);
        debugLog('Command completed:', {
          command: trimmedCommand,
          durationMs: Date.now() - startedAt,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          outputLength: output.length,
        });
        resolve(output);
      });
    });
  });
}
