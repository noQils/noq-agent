#!/usr/bin/env node
import 'dotenv/config';
import { isAgentMode, type AgentMode } from './agentMode';
import { getConfig } from './config';
import { runAgentTurn } from './workflow';

function printHelp() {
  console.log(`noq-agent - local AI coding agent CLI

Usage:
  noq "your prompt"
  noq --mode plan "your prompt"
  noq --mode build "your prompt"
  noq --plan "your prompt"
  noq --help
  noq --version

Examples:
  noq "Read src/tools/runCommand.ts and summarize it."
  noq --mode plan "Read src/tools and tell me how you would add a todo tool."
  noq "Use run_command to run npx tsc --noEmit and summarize the result."
`);
}

function printVersion() {
  console.log('1.0.0');
}

function parseCliMode(args: string[], defaultMode: AgentMode): { mode: AgentMode; promptParts: string[] } {
  const promptParts: string[] = [];
  let mode = defaultMode;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === '--plan') {
      mode = 'plan';
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

  return { mode, promptParts };
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
  const { mode, promptParts } = parseCliMode(args, config.defaultMode);
  const userPrompt = promptParts.join(' ').trim();

  if (userPrompt.length === 0) {
    throw new Error('Please provide a prompt after the mode flags.');
  }

  const response = await runAgentTurn(userPrompt, mode);
  console.log(response);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
