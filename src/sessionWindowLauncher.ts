import { spawnSync } from 'node:child_process';

import { type AgentMode } from './agentMode';

export interface LaunchSessionWindowOptions {
  sessionId: string;
  mode: AgentMode;
  cwd?: string;
}

export interface LaunchSessionWindowResult {
  launched: boolean;
  message?: string;
}

function isTsNodeEntry(entryPath: string): boolean {
  const normalizedEntryPath = entryPath.replaceAll('\\', '/').toLowerCase();
  return normalizedEntryPath.includes('/ts-node/') || normalizedEntryPath.endsWith('/ts-node');
}

function getCliBootstrapArgs(): string[] {
  const entryPath = process.argv[1];
  if (!entryPath) {
    throw new Error('Unable to determine the current CLI entrypoint.');
  }

  if (isTsNodeEntry(entryPath)) {
    const sourcePath = process.argv[2];
    if (!sourcePath) {
      throw new Error('Unable to determine the current ts-node source entrypoint.');
    }

    return [entryPath, sourcePath];
  }

  return [entryPath];
}

function buildChildArgs(options: LaunchSessionWindowOptions): string[] {
  return [
    ...getCliBootstrapArgs(),
    '--session',
    options.sessionId,
    '--mode',
    options.mode,
  ];
}

function canLaunchWindowsTerminal(): boolean {
  const result = spawnSync('wt.exe', ['--version'], {
    encoding: 'utf-8',
    windowsHide: true,
  });

  return !result.error && result.status === 0;
}

function tryLaunchWithWindowsTerminal(options: LaunchSessionWindowOptions): LaunchSessionWindowResult {
  const workingDirectory = options.cwd ?? process.cwd();
  const childArgs = buildChildArgs(options);
  const result = spawnSync(
    'wt.exe',
    [
      'new-tab',
      '-d',
      workingDirectory,
      process.execPath,
      ...childArgs,
    ],
    {
      encoding: 'utf-8',
      windowsHide: true,
    },
  );

  if (!result.error && result.status === 0) {
    return { launched: true };
  }

  return {
    launched: false,
    message: result.error?.message || result.stderr.trim() || 'wt.exe failed to open a new terminal window.',
  };
}

function escapePowerShellSingleQuotedValue(value: string): string {
  return value.replaceAll("'", "''");
}

function tryLaunchWithPowerShell(options: LaunchSessionWindowOptions): LaunchSessionWindowResult {
  const workingDirectory = options.cwd ?? process.cwd();
  const childArgs = buildChildArgs(options);
  const argumentList = [process.execPath, ...childArgs]
    .map((value) => `'${escapePowerShellSingleQuotedValue(value)}'`)
    .join(', ');

  const command = [
    `Set-Location -LiteralPath '${escapePowerShellSingleQuotedValue(workingDirectory)}'`,
    `Start-Process -FilePath '${escapePowerShellSingleQuotedValue(process.execPath)}' -ArgumentList @(${argumentList}) -WorkingDirectory '${escapePowerShellSingleQuotedValue(workingDirectory)}'`,
  ].join('; ');

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ],
    {
      encoding: 'utf-8',
      windowsHide: true,
    },
  );

  if (!result.error && result.status === 0) {
    return { launched: true };
  }

  return {
    launched: false,
    message: result.error?.message || result.stderr.trim() || 'PowerShell failed to open a new terminal window.',
  };
}

export function launchSessionWindow(options: LaunchSessionWindowOptions): LaunchSessionWindowResult {
  if (process.platform !== 'win32') {
    return {
      launched: false,
      message: 'Popup window mode is currently supported on Windows only. Starting the interactive session in the current terminal instead.',
    };
  }

  if (canLaunchWindowsTerminal()) {
    const wtResult = tryLaunchWithWindowsTerminal(options);
    if (wtResult.launched) {
      return wtResult;
    }
  }

  const powershellResult = tryLaunchWithPowerShell(options);
  if (powershellResult.launched) {
    return powershellResult;
  }

  return {
    launched: false,
    message: powershellResult.message ?? 'Failed to open a popup terminal window.',
  };
}
