import assert from 'node:assert/strict';
import test from 'node:test';

import { isHardBlockedCommand, resolveCommandPermission } from '../src/commandPolicy';
import { loadConfig } from '../src/config';
import { evaluatePermission } from '../src/permissions/evaluate';
import { runCommand } from '../src/tools/runCommand';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('loadConfig merges workspace config with safe defaults', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      defaultMode: 'plan',
      defaultProvider: 'openai',
      permission: {
        edit: 'allow',
        bash: {
          '*': 'ask',
          'npm test*': 'allow',
          'rm *': 'deny',
        },
      },
    }));

    const config = loadConfig();

    assert.equal(config.defaultMode, 'plan');
    assert.equal(config.defaultProvider, 'openai');
    assert.equal(config.permission.read, 'allow');
    assert.equal(config.permission.edit, 'allow');
    assert.equal(config.permission.external_directory, 'deny');
    assert.deepEqual(config.permission.bash, {
      '*': 'ask',
      'npm test*': 'allow',
      'rm *': 'deny',
    });
  });
});

test('loadConfig rejects invalid workspace config values', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      defaultMode: 'launch',
    }));

    assert.throws(
      () => loadConfig(),
      /defaultMode.*must be "plan" or "build"/,
    );
  });
});

test('bash command permission uses last matching rule', () => {
  const decision = resolveCommandPermission('npm test -- --watch=false', {
    '*': 'ask',
    'npm *': 'deny',
    'npm test*': 'allow',
  });

  assert.deepEqual(decision, {
    matchedPattern: 'npm test*',
    outcome: 'allow',
  });
});

test('external directory permission denies paths outside the workspace', async () => {
  await withTempWorkspace((workspace) => {
    const decision = evaluatePermission({
      scope: 'read',
      toolName: 'read_file',
      target: workspace.path('..', 'outside.txt'),
      args: {
        filePath: workspace.path('..', 'outside.txt'),
      },
    });

    assert.equal(decision.scope, 'external_directory');
    assert.equal(decision.outcome, 'deny');
  });
});

test('catastrophic commands are hard-blocked before execution', async () => {
  assert.equal(isHardBlockedCommand('rm -rf /'), true);

  await assert.rejects(
    () => runCommand('rm -rf /'),
    /Dangerous command is not allowed/,
  );
});
