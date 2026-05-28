import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { type AgentMode } from './agentMode';

export interface OpenTuiLaunchOptions {
  restoreStoredMode?: boolean;
  sessionId?: string;
}

const requireFromCurrentFile = createRequire(__filename);

function getExistingFile(candidates: string[], missingMessage: string): string {
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new Error(missingMessage);
  }

  return filePath;
}

function getOpenTuiEntrypoint(): string {
  return getExistingFile(
    [
      path.resolve(__dirname, 'opentui', 'index.tsx'),
      path.resolve(__dirname, '..', 'src', 'opentui', 'index.tsx'),
      path.resolve(process.cwd(), 'src', 'opentui', 'index.tsx'),
    ],
    'Could not locate the OpenTUI entrypoint.',
  );
}

function getOpenTuiSolidPreload(): string {
  let solidEntryPath: string;

  try {
    solidEntryPath = requireFromCurrentFile.resolve('@opentui/solid');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve @opentui/solid required to launch OpenTUI: ${message}`);
  }

  return getExistingFile(
    [path.join(path.dirname(solidEntryPath), 'scripts', 'preload.ts')],
    'Could not locate the @opentui/solid preload script required to launch OpenTUI.',
  );
}

export function buildOpenTuiBunArgs(
  sessionId: string | undefined,
  mode: AgentMode,
  options?: OpenTuiLaunchOptions,
): string[] {
  const args = [
    'run',
    '--preload',
    getOpenTuiSolidPreload(),
    getOpenTuiEntrypoint(),
    '--mode',
    mode,
  ];

  const resolvedSessionId = options?.sessionId ?? sessionId;
  if (resolvedSessionId) {
    args.push('--session', resolvedSessionId);
  }

  if (options?.restoreStoredMode) {
    args.push('--restore-mode');
  }

  return args;
}
