import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  resolveResumeWorkingDirectory,
  type ResumeWorkingDirectoryChoice,
} from '../src/cli';

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
