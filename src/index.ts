#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { getConfig } from './config';
import { resetPermissionApprovalState, setPermissionApprovalSession } from './permissions/approvals';
import {
  createSessionWithGeneratedId,
  getLatestSessionDiff,
  loadOrCreateSession,
  undoLastSessionSnapshot,
} from './sessionStore';
import { startInteractiveSession } from './interactiveSession';
import { launchSessionWindow } from './sessionWindowLauncher';
import { runSessionTurn } from './sessionTurnRunner';

type InteractiveLaunchMode = 'terminal' | 'popup';

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

Interactive session commands:
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
        'Select [1]: ',
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

type CliAction = 'chat' | 'diff' | 'undo';

interface ParsedCliArgs {
  mode: AgentMode;
  promptParts: string[];
  sessionId?: string;
  action: CliAction;
}

function parseCliArgs(args: string[], defaultMode: AgentMode): ParsedCliArgs {
  const promptParts: string[] = [];
  let mode = defaultMode;
  let sessionId: string | undefined;
  let action: CliAction = 'chat';

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--plan') {
      mode = 'plan';
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
      index++;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (!isAgentMode(value)) {
        throw new Error(`Invalid mode "${value}". Use "plan" or "build".`);
      }

      mode = value;
      continue;
    }

    promptParts.push(arg);
  }

  return {
    mode,
    promptParts,
    action,
    ...(sessionId ? { sessionId } : {}),
  };
}

// Main function to generate content
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    return;
  }

  const config = getConfig();
  const { mode, promptParts, sessionId, action } = parseCliArgs(args, config.defaultMode);
  const userPrompt = promptParts.join(' ').trim();

  if ((action === 'diff' || action === 'undo') && !sessionId) {
    throw new Error(`--${action} requires --session <id>.`);
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
      const activeSessionId = sessionId ?? createSessionWithGeneratedId().id;
      loadOrCreateSession(activeSessionId);
      setPermissionApprovalSession(activeSessionId);

      const launchMode = await selectInteractiveLaunchMode();
      if (launchMode === 'popup') {
        const launchResult = launchSessionWindow({
          sessionId: activeSessionId,
          mode,
        });

        if (launchResult.launched) {
          return;
        }

        printPopupFallbackMessage(
          launchResult.message ?? 'Popup window mode could not be started. Starting the interactive session in the current terminal instead.',
        );
      }

      await startInteractiveSession(activeSessionId, mode);
      return;
    }

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      activeSessionId = createSessionWithGeneratedId().id;
    }

    setPermissionApprovalSession(activeSessionId);

    const { response } = await runSessionTurn(activeSessionId, userPrompt, mode);
    console.log(response);
    printSessionContinuationHint(activeSessionId);
  } finally {
    resetPermissionApprovalState();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
