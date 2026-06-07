import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resetConfigCache } from '../src/config/config';
import { resetPermissionApprovalState, setPermissionApprovalSession } from '../src/permissions/approvals';
import {
  beginSessionChangeTracking,
  finishSessionChangeTracking,
  resetSessionChangeTracking,
} from '../src/session/sessionChangeTracker';
import { executeToolCall } from '../src/runtime/executeToolCall';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';
import { withTempWorkspace } from './helpers/tempWorkspace';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-cross-workspace-test-home-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');
  resetRuntimeEnvironmentForTests();

  try {
    return await callback();
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    resetRuntimeEnvironmentForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('read_file can read an absolute path outside the base workspace when external directories are allowed', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(async (workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        permission: {
          read: 'allow',
          external_directory: 'allow',
        },
      }));
      resetConfigCache();

      const externalWorkspace = workspace.path('..', `external-workspace-${path.basename(workspace.root)}`);
      const externalFilePath = path.join(externalWorkspace, 'notes.txt');
      fs.mkdirSync(path.dirname(externalFilePath), { recursive: true });
      fs.writeFileSync(externalFilePath, 'hello from outside\n', 'utf-8');

      const result = await executeToolCall('read_file', {
        filePath: externalFilePath,
      });

      assert.equal(result.executedToolCall.succeeded, true);
      assert.equal(result.output, 'hello from outside\n');
      fs.rmSync(externalWorkspace, { recursive: true, force: true });
    });
  });
});

test('run_command captures mutations made in an external cwd', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(async (workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        permission: {
          bash: 'allow',
          external_directory: 'allow',
        },
      }));
      resetConfigCache();
      setPermissionApprovalSession('cross-workspace-command-session');

      const externalWorkspace = workspace.path('..', `external-command-workspace-${path.basename(workspace.root)}`);
      fs.mkdirSync(externalWorkspace, { recursive: true });
      const createdFilePath = path.join(externalWorkspace, 'generated.txt');

      beginSessionChangeTracking();

      try {
        const result = await executeToolCall(
          'run_command',
          {
            command: `node -e "require('fs').writeFileSync('generated.txt', 'from external cwd\\n')"`,
            cwd: externalWorkspace,
          },
        );

        assert.equal(result.executedToolCall.succeeded, true);
        assert.equal(fs.readFileSync(createdFilePath, 'utf-8'), 'from external cwd\n');

        const sessionFileChanges = finishSessionChangeTracking().map((change) => change.filePath);
        assert.deepEqual(sessionFileChanges, [
          createdFilePath.replaceAll('\\', '/'),
        ]);
      } finally {
        resetSessionChangeTracking();
        resetPermissionApprovalState();
        fs.rmSync(externalWorkspace, { recursive: true, force: true });
      }
    });
  });
});
