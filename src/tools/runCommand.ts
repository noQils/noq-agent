import { execSync } from 'node:child_process';

import { checkIsDirectory } from '../fileUtils';
import { InternalTool } from './index';

type CommandSafety = 'trusted' | 'untrusted' | 'dangerous';

const TRUSTED_COMMANDS = new Set([
  'npx tsc --noEmit',
  'npx tsc --noEmit --pretty false',
  'npm test',
  'npm run build',
]);

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /\brmdir\b.*\/s/i,
  /\bdel\b.*\/s/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
];

function classifyCommand(command: string): CommandSafety {
  const normalized = command.trim().replace(/\s+/g, ' ');

  if (TRUSTED_COMMANDS.has(normalized)) {
    return 'trusted';
  }

  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'dangerous';
  }

  return 'untrusted';
}

function stringifyCommandOutput(value: unknown): string {
  if (!value) {
    return '';
  }

  return Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
}

function truncateOutput(output: string): string {
  const maxLength = 6000;
  return output.length > maxLength
    ? `${output.slice(0, maxLength)}\n... output truncated ...`
    : output;
}

function getCommandFailureDetails(error: unknown): string {
  const commandError = error as {
    message?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    status?: unknown;
    signal?: unknown;
  };

  const details = [
    typeof commandError.status === 'number' ? `exit status: ${commandError.status}` : '',
    commandError.signal ? `signal: ${String(commandError.signal)}` : '',
    stringifyCommandOutput(commandError.stdout).trim(),
    stringifyCommandOutput(commandError.stderr).trim(),
    typeof commandError.message === 'string' ? commandError.message : '',
  ].filter(Boolean);

  return truncateOutput(Array.from(new Set(details)).join('\n'));
}

export const runCommandTool: InternalTool = {
  name: 'run_command',
  description: 'Run a trusted command and return the output. Untrusted or dangerous commands are rejected.',
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

export function runCommand(command: string, cwd?: string) {
  const safety = classifyCommand(command);

  if (safety === 'untrusted') {
    throw new Error(`Command is not trusted: ${command}`);
  }

  if (safety === 'dangerous') {
    throw new Error(`Dangerous command is not allowed: ${command}`);
  }

  if (cwd && !checkIsDirectory(cwd)) {
    throw new Error(`${cwd} is not a directory`);
  }

  try {
    return execSync(command, { cwd: cwd ?? process.cwd(), encoding: 'utf-8' });
  } catch (error) {
    throw new Error(`Command ${command} failed:\n${getCommandFailureDetails(error)}`);
  }
}
