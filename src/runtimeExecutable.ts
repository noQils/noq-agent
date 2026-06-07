#!/usr/bin/env bun
import { runCli } from './cli';
import { launchSessionWindow } from './session/sessionWindowLauncher';
import { startOpenTuiInteractiveSession } from './opentui/startOpenTuiInteractiveSession';

async function main(): Promise<void> {
  await runCli(process.argv.slice(2), {
    startInteractiveSession: startOpenTuiInteractiveSession,
    launchSessionWindow,
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
