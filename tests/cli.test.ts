import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type AgentMode } from '../src/agentMode';
import {
  runCli,
  resolveResumeWorkingDirectory,
  type InteractiveSessionOptions,
  type ResumeWorkingDirectoryChoice,
} from '../src/cli';
import { getSessionFilePath } from '../src/sessionStore';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-cli-test-home-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');

  try {
    return await callback();
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('resolveResumeWorkingDirectory skips prompting when cwd matches the stored session root', async () => {
  let promptCalled = false;
  const workspaceRoot = path.resolve('C:/Users/TUF/projects/noq-agent');

  const resolvedWorkingDirectory = await resolveResumeWorkingDirectory(
    workspaceRoot,
    path.join(workspaceRoot, '.'),
    {
      promptForChoice: async (): Promise<ResumeWorkingDirectoryChoice> => {
        promptCalled = true;
        return 'current';
      },
    },
  );

  assert.equal(resolvedWorkingDirectory, workspaceRoot);
  assert.equal(promptCalled, false);
});

test('resolveResumeWorkingDirectory returns the current cwd when the user chooses current', async () => {
  const sessionWorkspaceRoot = path.resolve('C:/Users/TUF/projects/original-workspace');
  const currentWorkingDirectory = path.resolve('C:/Users/TUF/downloads/test');

  const resolvedWorkingDirectory = await resolveResumeWorkingDirectory(
    sessionWorkspaceRoot,
    currentWorkingDirectory,
    {
      promptForChoice: async (): Promise<ResumeWorkingDirectoryChoice> => 'current',
    },
  );

  assert.equal(resolvedWorkingDirectory, currentWorkingDirectory);
});

test('resolveResumeWorkingDirectory returns the session root when prompting is unavailable', async () => {
  const sessionWorkspaceRoot = path.resolve('C:/Users/TUF/projects/original-workspace');
  const currentWorkingDirectory = path.resolve('C:/Users/TUF/downloads/test');

  const resolvedWorkingDirectory = await resolveResumeWorkingDirectory(
    sessionWorkspaceRoot,
    currentWorkingDirectory,
    {
      canPrompt: false,
      promptForChoice: async (): Promise<ResumeWorkingDirectoryChoice> => 'current',
    },
  );

  assert.equal(resolvedWorkingDirectory, sessionWorkspaceRoot);
});

test('resolveResumeWorkingDirectory throws when prompting is unavailable and an explicit error message is provided', async () => {
  const sessionWorkspaceRoot = path.resolve('C:/Users/TUF/projects/original-workspace');
  const currentWorkingDirectory = path.resolve('C:/Users/TUF/downloads/test');

  await assert.rejects(
    () => resolveResumeWorkingDirectory(
      sessionWorkspaceRoot,
      currentWorkingDirectory,
      {
        canPrompt: false,
        promptUnavailableErrorMessage: 'resume cwd choice required',
      },
    ),
    /resume cwd choice required/,
  );
});

test('runCli passes the resolved resume cwd to current-terminal interactive startup', async () => {
  await withTempNoqHome(async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const workspaceRoot = path.resolve('C:/Users/TUF/projects/noq-agent');
    const sessionId = 'resume-cli-session';
    const sessionFilePath = getSessionFilePath(sessionId);

    fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
    fs.writeFileSync(
      sessionFilePath,
      JSON.stringify({
        id: sessionId,
        workspaceRoot,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        turns: [],
        snapshots: [],
        permissionApprovals: [],
        latestPlanArtifact: null,
        tuiState: { mode: null, entries: [] },
        approvedExternalDirectories: [],
      }),
      'utf-8',
    );

    const originalCwd = process.cwd();
    const capturedCalls: Array<{
      sessionId: string | undefined;
      mode: AgentMode;
      options: InteractiveSessionOptions | undefined;
    }> = [];

    try {
      fs.mkdirSync(workspaceRoot, { recursive: true });
      process.chdir(workspaceRoot);
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });

      await runCli(['--session', sessionId, '--tui'], {
        startInteractiveSession: async (capturedSessionId, mode, options) => {
          capturedCalls.push({ sessionId: capturedSessionId, mode, options });
        },
        launchSessionWindow: () => ({ launched: false }),
      });
    } finally {
      process.chdir(originalCwd);
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalStdinIsTTY });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTTY });
    }

    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0]?.sessionId, sessionId);
    assert.equal(capturedCalls[0]?.options?.cwd, workspaceRoot);
  });
});

test('runCli errors for non-interactive resumed one-shot turns when cwd choice is required', async () => {
  await withTempNoqHome(async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const sessionWorkspaceRoot = path.resolve('C:/Users/TUF/projects/original-workspace');
    const currentWorkingDirectory = path.resolve('C:/Users/TUF/downloads/test');
    const sessionId = 'resume-cli-non-interactive';
    const sessionFilePath = getSessionFilePath(sessionId);

    fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
    fs.writeFileSync(
      sessionFilePath,
      JSON.stringify({
        id: sessionId,
        workspaceRoot: sessionWorkspaceRoot,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        turns: [],
        snapshots: [],
        permissionApprovals: [],
        latestPlanArtifact: null,
        tuiState: { mode: null, entries: [] },
        approvedExternalDirectories: [],
      }),
      'utf-8',
    );

    const originalCwd = process.cwd();

    try {
      fs.mkdirSync(sessionWorkspaceRoot, { recursive: true });
      fs.mkdirSync(currentWorkingDirectory, { recursive: true });
      process.chdir(currentWorkingDirectory);
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });

      await assert.rejects(
        () => runCli(['--session', sessionId, 'Continue'], {
          startInteractiveSession: async () => undefined,
          launchSessionWindow: () => ({ launched: false }),
        }),
        /Cannot resume session .* non-interactively because its stored workspace directory differs from the current working directory\./,
      );
    } finally {
      process.chdir(originalCwd);
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalStdinIsTTY });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTTY });
    }
  });
});
