import { spawnSync } from 'node:child_process';

import { type AgentMode } from './agentMode';
import { buildOpenTuiBunArgs } from './openTuiLaunchPaths';

export interface LaunchSessionWindowOptions {
  sessionId?: string;
  mode: AgentMode;
  restoreStoredMode?: boolean;
  cwd?: string;
}

export interface LaunchSessionWindowResult {
  launched: boolean;
  message?: string;
}

function buildChildArgs(options: LaunchSessionWindowOptions): string[] {
  return buildOpenTuiBunArgs(
    options.sessionId,
    options.mode,
    {
      ...(options.restoreStoredMode ? { restoreStoredMode: true } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    },
  );
}

function formatWindowsTerminalTitle(sessionId?: string): string {
  return sessionId ? `noq /// ${sessionId}` : 'noq /// new session';
}

function escapePowerShellSingleQuotedValue(value: string): string {
  return value.replaceAll("'", "''");
}

function buildPowerShellBunCommand(options: LaunchSessionWindowOptions): string {
  const argumentList = buildChildArgs(options)
    .map((value) => `'${escapePowerShellSingleQuotedValue(value)}'`)
    .join(', ');

  return [
    `& 'bun' @(${argumentList})`,
    '$noqExitCode = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }',
    `if ($noqExitCode -ne 0) { Write-Host ''; Write-Host "noq exited with code $noqExitCode."; Read-Host 'Press Enter to close'; exit $noqExitCode }`,
  ].join('; ');
}

function encodePowerShellCommand(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function tryLaunchWithWindowsTerminal(options: LaunchSessionWindowOptions): LaunchSessionWindowResult {
  const workingDirectory = options.cwd ?? process.cwd();
  const result = spawnSync(
    'wt.exe',
    [
      '-w',
      '-1',
      'new-tab',
      '--tabColor',
      '#1f2126',
      '--title',
      formatWindowsTerminalTitle(options.sessionId),
      '--suppressApplicationTitle',
      '-d',
      workingDirectory,
      'powershell.exe',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodePowerShellCommand(buildPowerShellBunCommand(options)),
    ],
    {
      encoding: 'utf-8',
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

function tryLaunchWithPowerShell(options: LaunchSessionWindowOptions): LaunchSessionWindowResult {
  const workingDirectory = options.cwd ?? process.cwd();
  const childCommand = [
    `Set-Location -LiteralPath '${escapePowerShellSingleQuotedValue(workingDirectory)}'`,
    buildPowerShellBunCommand(options),
  ].join('; ');
  const argumentList = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShellCommand(childCommand),
  ]
    .map((value) => `'${escapePowerShellSingleQuotedValue(value)}'`)
    .join(', ');

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Start-Process -FilePath 'powershell.exe' -ArgumentList @(${argumentList}) -WorkingDirectory '${escapePowerShellSingleQuotedValue(workingDirectory)}' -WindowStyle Normal`,
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

  const wtResult = tryLaunchWithWindowsTerminal(options);
  if (wtResult.launched) {
    return wtResult;
  }

  const powershellResult = tryLaunchWithPowerShell(options);
  if (powershellResult.launched) {
    return powershellResult;
  }

  return {
    launched: false,
    message: wtResult.message ?? powershellResult.message ?? 'Failed to open a popup terminal window.',
  };
}
