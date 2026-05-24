#!/usr/bin/env node
import 'dotenv/config';
import { isAgentMode, type AgentMode } from './agentMode';
import { getConfig } from './config';
import { beginSessionChangeTracking, finishSessionChangeTracking, resetSessionChangeTracking } from './sessionChangeTracker';
import { appendSessionTurn, buildSessionHistoryMessages, getLatestSessionDiff, loadOrCreateSession, undoLastSessionSnapshot } from './sessionStore';
import { runAgentTurn } from './workflow';

function printHelp() {
  console.log(`noq-agent - local AI coding agent CLI

Usage:
  noq "your prompt"
  noq --session my-session "your prompt"
  noq --mode plan "your prompt"
  noq --mode build "your prompt"
  noq --session my-session --diff
  noq --session my-session --undo
  noq --plan "your prompt"
  noq --help
  noq --version

Examples:
  noq "Read src/tools/runCommand.ts and summarize it."
  noq --mode plan "Read src/tools and tell me how you would add a todo tool."
  noq "Use run_command to run npx tsc --noEmit and summarize the result."
  noq --session feature-a "Create src/example.ts and verify it."
  noq --session feature-a --diff
  noq --session feature-a --undo
`);
}

function printVersion() {
  console.log('1.0.0');
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

  if (args.length === 0) {
    printHelp();
    process.exit(1);
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

  if (userPrompt.length === 0) {
    throw new Error('Please provide a prompt after the mode flags.');
  }

  if (!sessionId) {
    const response = await runAgentTurn(userPrompt, mode);
    console.log(response);
    return;
  }

  const session = loadOrCreateSession(sessionId);
  const historyMessages = buildSessionHistoryMessages(session);

  beginSessionChangeTracking();
  let response: string;

  try {
    response = await runAgentTurn(userPrompt, mode, { historyMessages });
  } catch (error) {
    resetSessionChangeTracking();
    throw error;
  }

  const fileChanges = finishSessionChangeTracking();
  appendSessionTurn(
    sessionId,
    {
      timestamp: new Date().toISOString(),
      mode,
      userPrompt,
      response,
    },
    fileChanges,
  );

  console.log(response);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
