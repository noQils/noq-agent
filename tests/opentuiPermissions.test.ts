import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resetConfigCache } from '../src/config/config';
import {
  getBashWorkspaceOutcome,
  getNextPermissionOutcome,
  getPermissionsEditorItems,
  parseSlashCommand,
} from '../src/opentui/permissionsEditorState';
import { setSessionPermissionOverride } from '../src/session/sessionStore';
import { withTempWorkspace } from './helpers/tempWorkspace';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-opentui-test-home-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');

  try {
    return await callback();
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    resetConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('parseSlashCommand recognizes /permissions', () => {
  assert.deepEqual(parseSlashCommand('/permissions'), { type: 'permissions' });
});

test('parseSlashCommand treats unknown slash commands as invalid', () => {
  assert.deepEqual(parseSlashCommand('/wat'), { type: 'invalid' });
});

test('getNextPermissionOutcome cycles ask allow deny', () => {
  assert.equal(getNextPermissionOutcome('ask'), 'allow');
  assert.equal(getNextPermissionOutcome('allow'), 'deny');
  assert.equal(getNextPermissionOutcome('deny'), 'ask');
});

test('getBashWorkspaceOutcome uses rule fallback when bash config is rule-based', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        bash: {
          '*': 'ask',
          'npm test*': 'allow',
        },
      },
    }));

    assert.equal(getBashWorkspaceOutcome(), 'ask');
  });
});

test('getPermissionsEditorItems uses workspace values when no session override exists', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        edit: 'deny',
        bash: {
          '*': 'ask',
          'npm test*': 'allow',
        },
      },
    }));

    const items = getPermissionsEditorItems(null);
    const editItem = items.find((item) => item.scope === 'edit');
    const bashItem = items.find((item) => item.scope === 'bash');
    const todoItem = items.find((item) => item.scope === 'todo');

    assert.equal(todoItem, undefined);
    assert.equal(items.length, 7);
    assert.deepEqual(editItem, {
      scope: 'edit',
      outcome: 'deny',
      source: 'workspace',
      scopeDescription: 'Create or modify files.',
      description: 'Workspace config default',
    });
    assert.deepEqual(bashItem, {
      scope: 'bash',
      outcome: 'ask',
      source: 'workspace_rules',
      scopeDescription: 'Run shell commands.',
      description: 'Workspace bash rules fallback',
    });
  });
});

test('getPermissionsEditorItems surfaces session overrides over workspace config', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        permission: {
          edit: 'deny',
          bash: 'allow',
        },
      }));

      setSessionPermissionOverride('permissions-items-session', 'edit', 'allow');
      setSessionPermissionOverride('permissions-items-session', 'bash', 'deny');

      const items = getPermissionsEditorItems('permissions-items-session');
      const editItem = items.find((item) => item.scope === 'edit');
      const bashItem = items.find((item) => item.scope === 'bash');
      const todoItem = items.find((item) => item.scope === 'todo');

      assert.equal(todoItem, undefined);
      assert.deepEqual(editItem, {
        scope: 'edit',
        outcome: 'allow',
        source: 'session',
        scopeDescription: 'Create or modify files.',
        description: 'Session override active',
      });
      assert.deepEqual(bashItem, {
        scope: 'bash',
        outcome: 'deny',
        source: 'session',
        scopeDescription: 'Run shell commands.',
        description: 'Session-wide shell mode',
      });
    });
  });
});
