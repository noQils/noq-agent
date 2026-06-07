import readline from 'node:readline/promises';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { getConfig } from './config/config';
import { resetPermissionApprovalState, setPermissionApprovalSession } from './permissions/approvals';
import {
  createSessionWithGeneratedId,
  getLatestSessionDiff,
  loadExistingSession,
  undoLastSessionSnapshot,
} from './session/sessionStore';
import { runSessionTurn } from './session/sessionTurnRunner';

export type InteractiveLaunchMode = 'terminal' | 'popup';
export type CliAction = 'chat' | 'diff' | 'undo';

export const INTERNAL_OPENTUI_FLAG = '--internal-opentui';

export interface InteractiveSessionOptions {
  restoreStoredMode?: boolean;
  cwd?: string;
}

export type ResumeWorkingDirectoryChoice = 'session' | 'current';

export interface LaunchSessionWindowOptions extends InteractiveSessionOptions {
  sessionId?: string;
  mode: AgentMode;
  cwd?: string;
}

export interface LaunchSessionWindowResult {
  launched: boolean;
  message?: string;
}

export interface CliRuntime {
  startInteractiveSession: (
    sessionId: string | undefined,
    initialMode: AgentMode,
    options?: InteractiveSessionOptions,
  ) => Promise<void>;
  launchSessionWindow: (options: LaunchSessionWindowOptions) => LaunchSessionWindowResult;
}

interface ParsedCliArgs {
  mode: AgentMode;
  modeExplicit: boolean;
  promptParts: string[];
  sessionId?: string;
  action: CliAction;
  directTui: boolean;
  internalOpenTui: boolean;
  restoreStoredMode: boolean;
}

function printHelp() {
  console.log(`noq-agent - local AI coding agent CLI

Usage:
  noq
  noq "your prompt"
  noq --session <session-id>
  noq --session <session-id> "your prompt"
  noq --mode plan "your prompt"
  noq --mode build "your prompt"
  noq --session <session-id> --diff
  noq --session <session-id> --undo
  noq --plan "your prompt"
  noq --help
  noq --version

Examples:
  noq
  noq "Read src/tools/runCommand.ts and summarize it."
  noq --mode plan "Read src/tools and tell me how you would add a todo tool."
  noq "Use run_command to run npx tsc --noEmit and summarize the result."
  noq --session session-20260527-114600
  noq --session session-20260527-114600 "Create src/example.ts and verify it."
  noq --session session-20260527-114600 --diff
  noq --session session-20260527-114600 --undo

Interactive session startup:
  Starting or resuming a conversation first asks whether to use:
  - the current terminal OpenTUI session UI
  - a popup terminal window running the same OpenTUI session UI
  The interactive TUI runs in the terminal's alternate screen buffer, so it takes over the terminal window while active and restores the previous shell screen on exit.
  Popup window mode currently launches a separate terminal window on Windows.

Interactive session commands:
  /connect
  /models
  /mode plan
  /mode build
  /plan show
  /diff
  /undo
  /exit
`);
}

function printVersion() {
  console.log('1.0.0');
}

function printSessionContinuationHint(sessionId: string): void {
  console.log(`\nTo continue this conversation use: noq --session ${sessionId}`);
}

async function promptForResumeWorkingDirectoryChoice(
  sessionWorkspaceRoot: string,
  currentWorkingDirectory: string,
): Promise<ResumeWorkingDirectoryChoice> {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(
      [
        'Choose working directory to resume this session:',
        '  Session = this session\'s original workspace directory',
        '  Current = your current working directory',
        '',
        `  1. Use session directory (${sessionWorkspaceRoot})`,
        `  2. Use current directory (${currentWorkingDirectory})`,
        'Select: ',
      ].join('\n'),
    );

    const normalizedAnswer = answer.trim().toLowerCase();
    if (normalizedAnswer === '1' || normalizedAnswer === 'session' || normalizedAnswer === 's') {
      return 'session';
    }

    return 'current';
  } finally {
    rl.close();
  }
}

export async function resolveResumeWorkingDirectory(
  sessionWorkspaceRoot: string,
  currentWorkingDirectory: string,
  options?: {
    canPrompt?: boolean;
    promptUnavailableErrorMessage?: string;
    promptForChoice?: (
      sessionWorkspaceRoot: string,
      currentWorkingDirectory: string,
    ) => Promise<ResumeWorkingDirectoryChoice>;
  },
): Promise<string> {
  const resolvedSessionWorkspaceRoot = path.resolve(sessionWorkspaceRoot);
  const resolvedCurrentWorkingDirectory = path.resolve(currentWorkingDirectory);

  if (resolvedSessionWorkspaceRoot === resolvedCurrentWorkingDirectory) {
    return resolvedSessionWorkspaceRoot;
  }

  if (options?.canPrompt === false) {
    if (options.promptUnavailableErrorMessage) {
      throw new Error(options.promptUnavailableErrorMessage);
    }

    return resolvedSessionWorkspaceRoot;
  }

  const choice = await (options?.promptForChoice ?? promptForResumeWorkingDirectoryChoice)(
    resolvedSessionWorkspaceRoot,
    resolvedCurrentWorkingDirectory,
  );

  return choice === 'current'
    ? resolvedCurrentWorkingDirectory
    : resolvedSessionWorkspaceRoot;
}

async function selectInteractiveLaunchMode(): Promise<InteractiveLaunchMode> {
  if (!input.isTTY || !output.isTTY) {
    return 'terminal';
  }

  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(
      [
        'Choose how to open the interactive session:',
        '  1. Use current terminal',
        '  2. Open popup window',
        'Select: ',
      ].join('\n'),
    );

    const normalizedAnswer = answer.trim().toLowerCase();
    if (normalizedAnswer === '2' || normalizedAnswer === 'popup' || normalizedAnswer === 'p') {
      return 'popup';
    }

    return 'terminal';
  } finally {
    rl.close();
  }
}

function printPopupFallbackMessage(message: string): void {
  console.log(message);
}

function parseCliArgs(args: string[], defaultMode: AgentMode): ParsedCliArgs {
  const promptParts: string[] = [];
  let mode = defaultMode;
  let modeExplicit = false;
  let sessionId: string | undefined;
  let action: CliAction = 'chat';
  let directTui = false;
  let internalOpenTui = false;
  let restoreStoredMode = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--plan') {
      mode = 'plan';
      modeExplicit = true;
      continue;
    }

    if (arg === '--diff') {
      action = 'diff';
      continue;
    }

    if (arg === '--undo') {
      action = 'undo';
      continue;
    }

    if (arg === '--tui') {
      directTui = true;
      continue;
    }

    if (arg === INTERNAL_OPENTUI_FLAG) {
      internalOpenTui = true;
      directTui = true;
      continue;
    }

    if (arg === '--restore-mode') {
      restoreStoredMode = true;
      continue;
    }

    if (arg === '--session') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value after --session.');
      }

      sessionId = value;
      index++;
      continue;
    }

    if (arg.startsWith('--session=')) {
      sessionId = arg.slice('--session='.length);
      continue;
    }

    if (arg === '--mode') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('Missing value after --mode. Use "plan" or "build".');
      }

      if (!isAgentMode(value)) {
        throw new Error(`Invalid mode "${value}". Use "plan" or "build".`);
      }

      mode = value;
      modeExplicit = true;
      index++;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!isAgentMode(value)) {
        throw new Error(`Invalid mode "${value}". Use "plan" or "build".`);
      }

      mode = value;
      modeExplicit = true;
      continue;
    }

    promptParts.push(arg);
  }

  return {
    mode,
    modeExplicit,
    promptParts,
    action,
    directTui,
    internalOpenTui,
    restoreStoredMode,
    ...(sessionId ? { sessionId } : {}),
  };
}

export async function runCli(args: string[], runtime: CliRuntime): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    return;
  }

  const config = getConfig();
  const {
    mode,
    modeExplicit,
    promptParts,
    sessionId,
    action,
    directTui,
    internalOpenTui,
    restoreStoredMode,
  } = parseCliArgs(args, config.defaultMode);
  const userPrompt = promptParts.join(' ').trim();

  if ((action === 'diff' || action === 'undo') && !sessionId) {
    throw new Error(`--${action} requires --session <id>.`);
  }

  const existingSession = sessionId ? loadExistingSession(sessionId) : null;
  const resolvedResumeWorkingDirectory = existingSession && action === 'chat'
    ? internalOpenTui
      ? path.resolve(process.cwd())
      : await resolveResumeWorkingDirectory(existingSession.workspaceRoot, process.cwd(), {
        canPrompt: input.isTTY && output.isTTY,
        ...(userPrompt.length > 0 ? {
          promptUnavailableErrorMessage: [
            `Cannot resume session "${sessionId}" non-interactively because its stored workspace directory differs from the current working directory.`,
            `Stored session directory: ${path.resolve(existingSession.workspaceRoot)}`,
            `Current working directory: ${path.resolve(process.cwd())}`,
            'Rerun the command in an interactive terminal so noq can ask which directory to use, or rerun it from the intended directory.',
          ].join('\n'),
        } : {}),
      })
    : null;

  if (sessionId) {
    if (action === 'chat' && userPrompt.length === 0 && !directTui && !internalOpenTui) {
      void resolvedResumeWorkingDirectory;
    }
  }

  if (action !== 'chat') {
    if (userPrompt.length > 0) {
      throw new Error(`--${action} does not accept a prompt.`);
    }

    const response = action === 'diff'
      ? getLatestSessionDiff(sessionId!)
      : undoLastSessionSnapshot(sessionId!);
    console.log(response);
    return;
  }

  resetPermissionApprovalState();

  try {
    if (userPrompt.length === 0) {
      const activeSessionId = sessionId;
      const resolvedRestoreStoredMode = restoreStoredMode || !modeExplicit;
      setPermissionApprovalSession(activeSessionId);

      if (internalOpenTui) {
        await runtime.startInteractiveSession(activeSessionId, mode, {
          restoreStoredMode: resolvedRestoreStoredMode,
          ...(resolvedResumeWorkingDirectory ? { cwd: resolvedResumeWorkingDirectory } : {}),
        });
        return;
      }

      if (!directTui) {
        const launchMode = await selectInteractiveLaunchMode();
        if (launchMode === 'popup') {
          const launchResult = runtime.launchSessionWindow({
            mode,
            restoreStoredMode: resolvedRestoreStoredMode,
            ...(resolvedResumeWorkingDirectory ? { cwd: resolvedResumeWorkingDirectory } : {}),
            ...(activeSessionId ? { sessionId: activeSessionId } : {}),
          });

          if (launchResult.launched) {
            return;
          }

          printPopupFallbackMessage(
            launchResult.message ?? 'Popup window mode could not be started. Starting the interactive session in the current terminal instead.',
          );
        }
      }

      await runtime.startInteractiveSession(activeSessionId, mode, {
        restoreStoredMode: resolvedRestoreStoredMode,
        ...(resolvedResumeWorkingDirectory ? { cwd: resolvedResumeWorkingDirectory } : {}),
      });
      return;
    }

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      activeSessionId = createSessionWithGeneratedId().id;
    }

    setPermissionApprovalSession(activeSessionId);

    const { response } = await runSessionTurn(activeSessionId, userPrompt, mode, {
      ...(resolvedResumeWorkingDirectory ? { workingDirectory: resolvedResumeWorkingDirectory } : {}),
    });
    console.log(response);
    printSessionContinuationHint(activeSessionId);
  } finally {
    resetPermissionApprovalState();
  }
}
