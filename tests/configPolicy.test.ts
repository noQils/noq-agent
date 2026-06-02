import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { saveAuthStore } from '../src/authStore';
import { isHardBlockedCommand, resolveCommandPermission } from '../src/commandPolicy';
import { loadConfig } from '../src/config';
import { evaluatePermission } from '../src/permissions/evaluate';
import { saveGlobalConfig } from '../src/globalConfig';
import { getNoqHomeDirectory } from '../src/noqHome';
import { setPermissionApprovalSession } from '../src/permissions/approvals';
import { getConfiguredProviderNames, getExplicitProviderNameSetting, getProviderSettings } from '../src/providerSettings';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';
import { getSessionFilePath } from '../src/sessionStore';
import { runCommand } from '../src/tools/runCommand';
import { withTempWorkspace } from './helpers/tempWorkspace';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-config-test-home-'));

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

test('loadConfig merges workspace config with safe defaults', async () => {
  await withTempNoqHome(async () => {
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
});

test('loadConfig rejects invalid workspace config values', async () => {
  await withTempNoqHome(async () => {
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
});

test('loadConfig uses global defaults when workspace config is absent', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openrouter',
      defaultModel: 'openai/gpt-4.1-mini',
    });

    await withTempWorkspace(() => {
      const config = loadConfig();

      assert.equal(config.defaultProvider, 'openrouter');
      assert.equal(config.defaultModel, 'openai/gpt-4.1-mini');
      assert.equal(config.defaultMode, 'build');
    });
  });
});

test('workspace config overrides global defaults', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openrouter',
      defaultModel: 'openai/gpt-4.1-mini',
    });

    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        defaultProvider: 'openai',
        defaultModel: 'gpt-5.4-mini',
      }));

      const config = loadConfig();
      assert.equal(config.defaultProvider, 'openai');
      assert.equal(config.defaultModel, 'gpt-5.4-mini');
    });
  });
});

test('provider settings resolve credentials from auth store and model from global config', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    });
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
    });

    await withTempWorkspace(() => {
      const settings = getProviderSettings('openai');

      assert.equal(getNoqHomeDirectory(), path.resolve(process.env.NOQ_HOME!));
      assert.equal(settings.apiKey, 'openai-key');
      assert.equal(settings.model, 'gpt-5.4-mini');
      assert.deepEqual(getConfiguredProviderNames(), ['openai']);
      assert.equal(getExplicitProviderNameSetting(), 'openai');
    });
  });
});

test('workspace config overrides global model for provider settings', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    });
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
    });

    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        defaultModel: 'gpt-5.4',
      }));

      const settings = getProviderSettings('openai');
      assert.equal(settings.model, 'gpt-5.4');
    });
  });
});

test('environment variables override auth store and global config', async () => {
  const previousValues = new Map<string, string | undefined>();
  const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_PROVIDER'];

  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    });
    saveAuthStore({
      openai: { apiKey: 'auth-store-key' },
    });

    for (const envName of envNames) {
      previousValues.set(envName, process.env[envName]);
    }

    process.env.OPENAI_API_KEY = 'env-key';
    process.env.OPENAI_MODEL = 'gpt-5.4';
    process.env.AI_PROVIDER = 'openai';
    resetRuntimeEnvironmentForTests();

    try {
      await withTempWorkspace(() => {
        const settings = getProviderSettings('openai');
        assert.equal(settings.apiKey, 'env-key');
        assert.equal(settings.model, 'gpt-5.4');
        assert.equal(getExplicitProviderNameSetting(), 'openai');
      });
    } finally {
      for (const envName of envNames) {
        const previousValue = previousValues.get(envName);
        if (previousValue === undefined) {
          delete process.env[envName];
        } else {
          process.env[envName] = previousValue;
        }
      }
      resetRuntimeEnvironmentForTests();
    }
  });
});

test('multiple configured providers are detected from auth store plus global model', async () => {
  const previousValues = new Map<string, string | undefined>();
  const envNames = ['OPENAI_MODEL', 'GEMINI_MODEL'];

  await withTempNoqHome(async () => {
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
      gemini: { apiKey: 'gemini-key' },
    });

    for (const envName of envNames) {
      previousValues.set(envName, process.env[envName]);
    }

    process.env.OPENAI_MODEL = 'gpt-5.4-mini';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    resetRuntimeEnvironmentForTests();

    try {
      await withTempWorkspace(() => {
        assert.deepEqual(getConfiguredProviderNames(), ['gemini', 'openai']);
      });
    } finally {
      for (const envName of envNames) {
        const previousValue = previousValues.get(envName);
        if (previousValue === undefined) {
          delete process.env[envName];
        } else {
          process.env[envName] = previousValue;
        }
      }
      resetRuntimeEnvironmentForTests();
    }
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

test('external directory permission allows paths inside approved external directories', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      const approvedDirectory = workspace.path('..', 'approved-workspace');
      const sessionFilePath = getSessionFilePath('approved-dir-session');

      fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
      fs.writeFileSync(
        sessionFilePath,
        JSON.stringify({
          id: 'approved-dir-session',
          workspaceRoot: workspace.root,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          turns: [],
          snapshots: [],
          permissionApprovals: [],
          latestPlanArtifact: null,
          tuiState: { mode: null, entries: [] },
          approvedExternalDirectories: [approvedDirectory],
        }),
        'utf-8',
      );

      setPermissionApprovalSession('approved-dir-session');

      const decision = evaluatePermission({
        scope: 'read',
        toolName: 'read_file',
        target: path.join(approvedDirectory, 'notes.txt'),
        args: {
          filePath: path.join(approvedDirectory, 'notes.txt'),
        },
      });

      assert.equal(decision.scope, 'read');
      assert.equal(decision.outcome, 'allow');
    });
  });
});

test('external directory permission can ask for new outside paths', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        external_directory: 'ask',
      },
    }));

    const decision = evaluatePermission({
      scope: 'read',
      toolName: 'read_file',
      target: workspace.path('..', 'outside.txt'),
      args: {
        filePath: workspace.path('..', 'outside.txt'),
      },
    });

    assert.equal(decision.scope, 'external_directory');
    assert.equal(decision.outcome, 'ask');
  });
});

test('external directory permission applies to command cwd', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('noq-agent.json', JSON.stringify({
      permission: {
        external_directory: 'ask',
      },
    }));

    const decision = evaluatePermission({
      scope: 'bash',
      toolName: 'run_command',
      target: 'npm test',
      args: {
        command: 'npm test',
        cwd: workspace.path('..', 'outside-workspace'),
      },
    });

    assert.equal(decision.scope, 'external_directory');
    assert.equal(decision.outcome, 'ask');
  });
});

test('catastrophic commands are hard-blocked before execution', async () => {
  assert.equal(isHardBlockedCommand('rm -rf /'), true);

  await assert.rejects(
    () => runCommand('rm -rf /'),
    /Dangerous command is not allowed/,
  );
});
