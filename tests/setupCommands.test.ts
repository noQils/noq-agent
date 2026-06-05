import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadAuthStore } from '../src/authStore';
import { resetConfigCache } from '../src/config';
import { loadGlobalConfig } from '../src/globalConfig';
import { resolveProviderName } from '../src/providers';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';
import {
  formatModelChoiceList,
  formatProviderChoiceList,
  getModelProviderChoices,
  getModelChoices,
  parseModelChoice,
  parseProviderChoice,
  saveGlobalModelSelection,
  saveProviderConnection,
} from '../src/setupCommands';
import { saveAuthStore } from '../src/authStore';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-setup-commands-test-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');
  resetRuntimeEnvironmentForTests();
  resetConfigCache();

  try {
    return await callback();
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    resetRuntimeEnvironmentForTests();
    resetConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('parseProviderChoice accepts numeric and named selections', () => {
  const providers = ['openai', 'gemini', 'ollama'] as const;

  assert.equal(parseProviderChoice('1', providers as unknown as Array<typeof providers[number]>), 'openai');
  assert.equal(parseProviderChoice('gemini', providers as unknown as Array<typeof providers[number]>), 'gemini');
  assert.equal(parseProviderChoice('9', providers as unknown as Array<typeof providers[number]>), null);
});

test('parseModelChoice accepts presets and custom', () => {
  assert.equal(parseModelChoice('1', 3), 0);
  assert.equal(parseModelChoice('4', 3), 'custom');
  assert.equal(parseModelChoice('custom', 3), 'custom');
  assert.equal(parseModelChoice('0', 3), null);
});

test('saveProviderConnection persists auth records', async () => {
  await withTempNoqHome(() => {
    saveProviderConnection('openai', { apiKey: 'openai-key' });
    const authStore = loadAuthStore();

    assert.equal(authStore.openai?.apiKey, 'openai-key');
  });
});

test('saveGlobalModelSelection persists default provider and model', async () => {
  await withTempNoqHome(() => {
    saveGlobalModelSelection('gemini', 'gemini-2.5-flash');
    const globalConfig = loadGlobalConfig();

    assert.equal(globalConfig.defaultProvider, 'gemini');
    assert.equal(globalConfig.defaultModel, 'gemini-2.5-flash');
  });
});

test('saveProviderConnection makes a provider immediately selectable without changing the active default', async () => {
  await withTempNoqHome(() => {
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
    });
    saveGlobalModelSelection('openai', 'gpt-5.4-mini');

    assert.equal(resolveProviderName(), 'openai');
    assert.deepEqual(getModelProviderChoices().slice(0, 2), ['openai', 'ollama']);

    saveProviderConnection('openrouter', { apiKey: 'openrouter-key' });

    assert.equal(resolveProviderName(), 'openai');
    assert.equal(getModelProviderChoices()[0], 'openai');
    assert.ok(getModelProviderChoices().includes('openrouter'));
  });
});

test('saveGlobalModelSelection takes effect immediately in the current process', async () => {
  await withTempNoqHome(() => {
    saveAuthStore({
      openai: { apiKey: 'openai-key' },
      openrouter: { apiKey: 'openrouter-key' },
    });

    saveGlobalModelSelection('openai', 'gpt-5.4-mini');
    assert.equal(resolveProviderName(), 'openai');

    saveGlobalModelSelection('openrouter', 'openai/gpt-4.1-mini');

    assert.equal(resolveProviderName(), 'openrouter');
  });
});

test('format helpers include expected options', () => {
  assert.match(formatProviderChoiceList(['openai', 'gemini']), /1\. openai/);
  assert.match(formatModelChoiceList(['gpt-5.4-mini']), /custom/);
});

test('getModelChoices falls back to presets when live discovery is unavailable', async () => {
  const originalFetch = globalThis.fetch;

  await withTempNoqHome(async () => {
    globalThis.fetch = async () => {
      throw new Error('network unavailable');
    };

    try {
      const modelChoices = await getModelChoices('openrouter');

      assert.equal(modelChoices.source, 'fallback');
      assert.deepEqual(modelChoices.models, ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-flash']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('getModelChoices uses live OpenRouter models when discovery succeeds', async () => {
  const originalFetch = globalThis.fetch;

  await withTempNoqHome(async () => {
    saveAuthStore({
      openrouter: { apiKey: 'openrouter-key' },
    });

    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [
        { id: 'google/gemini-2.5-flash' },
        { id: 'openai/gpt-4.1-mini' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    try {
      const modelChoices = await getModelChoices('openrouter');

      assert.equal(modelChoices.source, 'live');
      assert.deepEqual(modelChoices.models, [
        'google/gemini-2.5-flash',
        'openai/gpt-4.1-mini',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
