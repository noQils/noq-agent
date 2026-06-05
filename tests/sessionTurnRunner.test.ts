import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runSessionTurn } from '../src/sessionTurnRunner';
import { getSessionFilePath } from '../src/sessionStore';
import { type ExecutedToolCall, type Provider } from '../src/providers/types';
import { withTempWorkspace } from './helpers/tempWorkspace';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-session-turn-home-'));

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

test('runSessionTurn uses the provided workingDirectory override for resumed turns', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionId = 'session-turn-runner-cwd';
      const sessionWorkspaceRoot = path.join(workspace.root, 'stored-workspace');
      const overrideWorkingDirectory = path.join(workspace.root, 'resume-here');
      const sessionFilePath = getSessionFilePath(sessionId);

      fs.mkdirSync(sessionWorkspaceRoot, { recursive: true });
      fs.mkdirSync(overrideWorkingDirectory, { recursive: true });
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

      let observedWorkingDirectory: string | null = null;
      const provider: Provider = {
        async chat() {
          observedWorkingDirectory = process.cwd();
          return {
            text: 'cwd captured',
            executedToolCalls: [],
            stopReason: 'no_tool_calls',
          };
        },
      };

      const result = await runSessionTurn(sessionId, 'report cwd', 'plan', {
        workingDirectory: overrideWorkingDirectory,
        provider,
      });

      assert.equal(result.response, 'cwd captured');
      assert.equal(observedWorkingDirectory, overrideWorkingDirectory);
    });
  });
});

test('runSessionTurn persists workingDirectory, stopReason, and executedToolCalls for the turn', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionId = 'session-turn-runner-tool-metadata';
      const workingDirectory = path.join(workspace.root, 'downloads-like-dir');
      const sessionFilePath = getSessionFilePath(sessionId);
      const executedToolCalls: ExecutedToolCall[] = [{
        toolName: 'list_dir',
        args: { dirPath: '.' },
        succeeded: true,
      }];

      fs.mkdirSync(workingDirectory, { recursive: true });

      const provider: Provider = {
        async chat() {
          return {
            text: 'Here are the files.',
            executedToolCalls,
            stopReason: 'no_tool_calls',
          };
        },
      };

      await runSessionTurn(sessionId, 'tell me the files here', 'build', {
        workingDirectory,
        provider,
      });

      const session = JSON.parse(fs.readFileSync(sessionFilePath, 'utf-8')) as {
        turns: Array<{
          workingDirectory?: string;
          stopReason?: string;
          executedToolCalls?: ExecutedToolCall[];
        }>;
      };
      const latestTurn = session.turns.at(-1);

      assert.equal(latestTurn?.workingDirectory, workingDirectory);
      assert.equal(latestTurn?.stopReason, 'no_tool_calls');
      assert.deepEqual(latestTurn?.executedToolCalls, executedToolCalls);
    });
  });
});
