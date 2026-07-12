import assert from 'node:assert/strict';
import test from 'node:test';

import { resetConfigCache } from '../src/config/config';
import { executeToolCall, resetPermissionDecisionCache } from '../src/runtime/executeToolCall';
import {
  resetPermissionPromptHandler,
  setPermissionPromptHandler,
} from '../src/permissions/prompt';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('executeToolCall succeeds without a TTY when an allow_once prompt handler is installed for an ask-scoped edit', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        read: 'allow',
        edit: 'ask',
      },
    }));
    resetConfigCache();
    resetPermissionDecisionCache();

    workspace.writeFile('greeting.txt', 'hello world');

    setPermissionPromptHandler(async () => 'allow_once');
    try {
      const result = await executeToolCall('edit_file', {
        filePath: workspace.path('greeting.txt'),
        oldText: 'hello world',
        newText: 'hello there',
      });

      assert.equal(result.executedToolCall.succeeded, true);
      assert.equal(workspace.readFile('greeting.txt'), 'hello there');
    } finally {
      resetPermissionPromptHandler();
    }
  });
});

test('executeToolCall still denies a policy-level deny scope even when an allow_once prompt handler is installed', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        read: 'allow',
        bash: 'deny',
      },
    }));
    resetConfigCache();
    resetPermissionDecisionCache();

    setPermissionPromptHandler(async () => 'allow_once');
    try {
      const result = await executeToolCall('run_command', {
        command: 'node --version',
      });

      assert.equal(result.executedToolCall.succeeded, false);
      assert.equal(result.executedToolCall.failureKind, 'permission_denied');
      assert.equal(result.executedToolCall.permissionDeniedBy, 'policy');
    } finally {
      resetPermissionPromptHandler();
    }
  });
});

test('executeToolCall denies an ask-scoped edit when no prompt handler is installed and streams are not TTY', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        read: 'allow',
        edit: 'ask',
      },
    }));
    resetConfigCache();
    resetPermissionDecisionCache();

    workspace.writeFile('greeting.txt', 'hello world');

    const result = await executeToolCall('edit_file', {
      filePath: workspace.path('greeting.txt'),
      oldText: 'hello world',
      newText: 'hello there',
    });

    assert.equal(result.executedToolCall.succeeded, false);
    assert.equal(result.executedToolCall.failureKind, 'permission_denied');
    assert.equal(result.executedToolCall.permissionDeniedBy, 'user');
    assert.equal(workspace.readFile('greeting.txt'), 'hello world');
  });
});
