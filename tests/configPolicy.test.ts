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
import { allowPermissionForSession, setPermissionApprovalSession } from '../src/permissions/approvals';
import {
  buildMissingProviderError,
  getConfiguredProviderNames,
  getExplicitProviderNameSetting,
  getProviderSettings,
  getRequiredProviderApiKey,
} from '../src/providerSettings';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';
import { getSessionApprovedExternalDirectories, getSessionFilePath } from '../src/sessionStore';
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

test('provider settings ignore environment variables for auth and model selection', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    });
    saveAuthStore({
      openai: { apiKey: 'auth-store-key' },
    });

    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousOpenAiModel = process.env.OPENAI_MODEL;
    const previousAiProvider = process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = 'env-key';
    process.env.OPENAI_MODEL = 'gpt-5.4';
    process.env.AI_PROVIDER = 'gemini';
    resetRuntimeEnvironmentForTests();

    try {
      await withTempWorkspace(() => {
        const settings = getProviderSettings('openai');
        assert.equal(settings.apiKey, 'auth-store-key');
        assert.equal(settings.model, 'gpt-5.4-mini');
        assert.equal(getExplicitProviderNameSetting(), 'openai');
      });
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = previousOpenAiModel;
      if (previousAiProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousAiProvider;
      resetRuntimeEnvironmentForTests();
    }
  });
});

test('multiple configured providers are detected from auth store plus workspace/global defaults only', async () => {
  await withTempNoqHome(async () => {
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
      gemini: { apiKey: 'gemini-key' },
    });
    saveGlobalConfig({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    });

    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        defaultProvider: 'gemini',
        defaultModel: 'gemini-2.5-flash',
      }));

      assert.deepEqual(getConfiguredProviderNames(), ['gemini']);
    });
  });
});

test('missing provider error points users to /connect and /models', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      const message = buildMissingProviderError();

      assert.match(message, /Run \/connect/);
      assert.match(message, /Run \/models/);
      assert.match(message, /For Ollama, you can skip \/connect/);
      assert.match(message, /~\/\.noq\/auth\.json/);
      assert.match(message, /~\/\.noq\/config\.json/);
    });
  });
});

test('missing hosted-provider credentials tell users to use /connect and /models', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      assert.throws(
        () => getRequiredProviderApiKey('openai'),
        /Run \/connect to save them into .*auth\.json, then use \/models/,
      );
    });
  });
});

test('ollama is treated as configured with model-only setup', async () => {
  await withTempNoqHome(async () => {
    saveGlobalConfig({
      defaultProvider: 'ollama',
      defaultModel: 'llama3.1:8b',
    });

    await withTempWorkspace(() => {
      assert.deepEqual(getConfiguredProviderNames(), ['ollama']);
      assert.equal(getExplicitProviderNameSetting(), 'ollama');
      assert.equal(getProviderSettings('ollama').model, 'llama3.1:8b');
    });
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

test('session approval persists approved external directories for later turns', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        permission: {
          external_directory: 'ask',
        },
      }));

      const approvedDirectory = workspace.path('..', 'approved-workspace');
      setPermissionApprovalSession('approved-session');
      allowPermissionForSession({
        scope: 'external_directory',
        toolName: 'read_file',
        target: approvedDirectory,
        args: {
          filePath: path.join(approvedDirectory, 'notes.txt'),
        },
      });

      assert.deepEqual(getSessionApprovedExternalDirectories('approved-session'), [
        path.resolve(approvedDirectory).replaceAll('\\', '/'),
      ]);

      setPermissionApprovalSession('approved-session');
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

test('session approval persists approved external command cwd after reload', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      workspace.writeFile('noq-agent.json', JSON.stringify({
        permission: {
          bash: 'allow',
          external_directory: 'ask',
        },
      }));

      const approvedDirectory = workspace.path('..', 'approved-command-workspace');
      setPermissionApprovalSession('approved-command-session');
      allowPermissionForSession({
        scope: 'external_directory',
        toolName: 'run_command',
        target: approvedDirectory,
        args: {
          command: 'npm test',
          cwd: approvedDirectory,
        },
      });

      setPermissionApprovalSession('approved-command-session');
      const decision = evaluatePermission({
        scope: 'bash',
        toolName: 'run_command',
        target: 'npm test',
        args: {
          command: 'npm test',
          cwd: approvedDirectory,
        },
      });

      assert.equal(decision.scope, 'bash');
      assert.equal(decision.outcome, 'allow');
    });
  });
});

test('catastrophic commands are hard-blocked before execution', async () => {
  assert.equal(isHardBlockedCommand('rm -rf /'), true);

  await assert.rejects(
    () => runCommand('rm -rf /'),
    /Dangerous command is not allowed/,
  );
});
