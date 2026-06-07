#!/usr/bin/env node
import { runCli } from './cli';
import { startInteractiveSession } from './session/interactiveSession';
import { launchSessionWindow } from './session/sessionWindowLauncher';

async function main(): Promise<void> {
  await runCli(process.argv.slice(2), {
    startInteractiveSession,
    launchSessionWindow,
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
