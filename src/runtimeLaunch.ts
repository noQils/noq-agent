import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { INTERNAL_OPENTUI_FLAG, type InteractiveSessionOptions } from './cli';
import { type AgentMode } from './agentMode';

const requireFromCurrentFile = createRequire(__filename);

export interface RuntimeLaunchSpec {
  command: string;
  args: string[];
}

function getExistingFile(candidates: string[], missingMessage: string): string {
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new Error(missingMessage);
  }

  return filePath;
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

function getRuntimeEntrypoint(): string {
  return getExistingFile(
    [
      path.resolve(__dirname, 'runtimeExecutable.js'),
      path.resolve(__dirname, '..', 'src', 'runtimeExecutable.ts'),
      path.resolve(process.cwd(), 'src', 'runtimeExecutable.ts'),
    ],
    'Could not locate the packaged runtime entrypoint.',
  );
}

function shouldUseDirectExecutable(): boolean {
  const currentScript = process.argv[1];
  return !currentScript || !/\.(?:c?js|m?js|ts|tsx)$/i.test(currentScript);
}

export function resolveRuntimeLaunchSpec(): RuntimeLaunchSpec {
  if (shouldUseDirectExecutable()) {
    return {
      command: process.execPath,
      args: [],
    };
  }

  const runtimeEntrypoint = getRuntimeEntrypoint();
  if (runtimeEntrypoint.endsWith('.js')) {
    return {
      command: process.execPath,
      args: [runtimeEntrypoint],
    };
  }

  return {
    command: process.platform === 'win32' ? 'bun.exe' : 'bun',
    args: [
      '--preload',
      getOpenTuiSolidPreload(),
      runtimeEntrypoint,
    ],
  };
}

export function buildInternalOpenTuiArgs(
  sessionId: string | undefined,
  mode: AgentMode,
  options?: InteractiveSessionOptions,
): string[] {
  const args = [
    INTERNAL_OPENTUI_FLAG,
    '--mode',
    mode,
  ];

  if (sessionId) {
    args.push('--session', sessionId);
  }

  if (options?.restoreStoredMode) {
    args.push('--restore-mode');
  }

  return args;
}
