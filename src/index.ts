#!/usr/bin/env node
import 'dotenv/config';
import { getConfig } from './config';
import { runAgentTurn } from './workflow';

function printHelp() {
  console.log(`noq-agent - local AI coding agent CLI

Usage:
  noq "your prompt"
  noq --help
  noq --version

Examples:
  noq "Read src/tools/runCommand.ts and summarize it."
  noq "Use run_command to run npx tsc --noEmit and summarize the result."
`);
}

function printVersion() {
  console.log('1.0.0');
}

// Main function to generate content
async function main() {
  const args = process.argv.slice(2);

  getConfig();

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

  const userPrompt = args.join(' ').trim();

  const response = await runAgentTurn(userPrompt);
  console.log(response);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
