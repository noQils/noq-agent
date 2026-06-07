import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { type AuthStore, loadAuthStore, saveAuthStore } from '../src/config/authStore';
import { type GlobalConfig, loadGlobalConfig, saveGlobalConfig } from '../src/config/globalConfig';
import {
  ensureNoqHomeDirectory,
  getAuthStorePath,
  getGlobalConfigPath,
  getGlobalSessionsDirectoryPath,
  getNoqHomeDirectory,
} from '../src/config/noqHome';

function withNoqHome<T>(callback: (root: string) => T): T {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-global-storage-test-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');

  try {
    return callback(root);
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('global storage paths resolve under NOQ_HOME', () => {
  withNoqHome(() => {
    const homeDirectory = getNoqHomeDirectory();
    assert.equal(homeDirectory, path.resolve(process.env.NOQ_HOME!));
    assert.equal(getGlobalConfigPath(), path.join(homeDirectory, 'config.json'));
    assert.equal(getAuthStorePath(), path.join(homeDirectory, 'auth.json'));
    assert.equal(getGlobalSessionsDirectoryPath(), path.join(homeDirectory, 'sessions'));
  });
});

test('ensureNoqHomeDirectory creates the global home directory', () => {
  withNoqHome(() => {
    const homeDirectory = getNoqHomeDirectory();
    assert.equal(fs.existsSync(homeDirectory), false);

    const ensuredPath = ensureNoqHomeDirectory();

    assert.equal(ensuredPath, homeDirectory);
    assert.equal(fs.statSync(homeDirectory).isDirectory(), true);
  });
});

test('loadGlobalConfig returns an empty object when config.json is missing', () => {
  withNoqHome(() => {
    assert.deepEqual(loadGlobalConfig(), {});
    assert.equal(fs.existsSync(getGlobalConfigPath()), false);
  });
});

test('loadGlobalConfig treats an empty config.json like a missing file', () => {
  withNoqHome(() => {
    ensureNoqHomeDirectory();
    fs.writeFileSync(getGlobalConfigPath(), '   \n', 'utf-8');

    assert.deepEqual(loadGlobalConfig(), {});
  });
});

test('saveGlobalConfig creates the home directory and round-trips config values', () => {
  withNoqHome(() => {
    const config: GlobalConfig = {
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4-mini',
    };

    saveGlobalConfig(config);

    assert.equal(fs.existsSync(getNoqHomeDirectory()), true);
    assert.deepEqual(loadGlobalConfig(), config);
  });
});

test('loadGlobalConfig rejects malformed JSON', () => {
  withNoqHome(() => {
    ensureNoqHomeDirectory();
    fs.writeFileSync(getGlobalConfigPath(), '{invalid', 'utf-8');

    assert.throws(
      () => loadGlobalConfig(),
      /Failed to read .*config\.json:/,
    );
  });
});

test('loadAuthStore returns an empty object when auth.json is missing', () => {
  withNoqHome(() => {
    assert.deepEqual(loadAuthStore(), {});
    assert.equal(fs.existsSync(getAuthStorePath()), false);
  });
});

test('saveAuthStore creates the home directory and round-trips provider auth values', () => {
  withNoqHome(() => {
    const store: AuthStore = {
      openai: { apiKey: 'openai-key' },
      openrouter: {
        apiKey: 'openrouter-key',
        httpReferer: 'https://example.com',
        appTitle: 'noq-agent',
      },
    };

    saveAuthStore(store);

    assert.equal(fs.existsSync(getNoqHomeDirectory()), true);
    assert.deepEqual(loadAuthStore(), store);
  });
});

test('loadAuthStore rejects malformed JSON', () => {
  withNoqHome(() => {
    ensureNoqHomeDirectory();
    fs.writeFileSync(getAuthStorePath(), '{invalid', 'utf-8');

    assert.throws(
      () => loadAuthStore(),
      /Failed to read .*auth\.json:/,
    );
  });
});
