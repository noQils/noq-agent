import { isAgentMode, type AgentMode } from '../agentMode';
import { startOpenTuiInteractiveSession } from './startOpenTuiInteractiveSession';

function getArgumentValue(flag: string): string | null {
  const flagIndex = process.argv.indexOf(flag);
  if (flagIndex < 0) {
    return null;
  }

  return process.argv[flagIndex + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function resolveMode(rawMode: string | null): AgentMode {
  if (rawMode && isAgentMode(rawMode)) {
    return rawMode;
  }

  return 'build';
}

async function main(): Promise<void> {
  const sessionId = getArgumentValue('--session') ?? 'opentui-preview';
  const mode = resolveMode(getArgumentValue('--mode'));
  await startOpenTuiInteractiveSession(sessionId, mode, {
    restoreStoredMode: hasFlag('--restore-mode'),
  });
}

void main().catch((error) => {
  console.error('Failed to start the OpenTUI interactive session:', error);
  process.exitCode = 1;
});
