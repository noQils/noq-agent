import assert from 'node:assert/strict';
import test from 'node:test';

import {
  debugLog,
  defaultProviderMaxToolRounds,
  defaultProviderTimeoutMs,
  getProviderMaxToolRounds,
  getProviderTimeoutMs,
  getRuntimeSettings,
  isDebugLoggingEnabled,
} from '../src/runtimeSettings';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';

const settingNames = [
  'NOQ_DEBUG',
  'NOQ_PROVIDER_TIMEOUT_MS',
  'NOQ_PROVIDER_MAX_TOOL_ROUNDS',
];

function withRuntimeEnv(values: Record<string, string>, callback: () => void): void {
  const previousValues = new Map<string, string | undefined>();

  for (const name of settingNames) {
    previousValues.set(name, process.env[name]);
    delete process.env[name];
  }

  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value;
  }

  resetRuntimeEnvironmentForTests();

  try {
    callback();
  } finally {
    for (const name of settingNames) {
      const previousValue = previousValues.get(name);
      if (previousValue === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousValue;
      }
    }

    resetRuntimeEnvironmentForTests();
  }
}

test('runtime settings use quiet defaults', () => {
  withRuntimeEnv({}, () => {
    assert.deepEqual(getRuntimeSettings(), {
      debug: false,
      providerTimeoutMs: defaultProviderTimeoutMs,
      providerMaxToolRounds: defaultProviderMaxToolRounds,
    });
  });
});

test('NOQ_DEBUG accepts explicit truthy values', () => {
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
    withRuntimeEnv({ NOQ_DEBUG: value }, () => {
      assert.equal(isDebugLoggingEnabled(), true);
    });
  }
});

test('provider numeric settings parse valid integer values', () => {
  withRuntimeEnv({
    NOQ_PROVIDER_TIMEOUT_MS: '2500',
    NOQ_PROVIDER_MAX_TOOL_ROUNDS: '3',
  }, () => {
    assert.equal(getProviderTimeoutMs(), 2500);
    assert.equal(getProviderMaxToolRounds(), 3);
  });
});

test('provider numeric settings reject invalid values', () => {
  withRuntimeEnv({ NOQ_PROVIDER_TIMEOUT_MS: 'fast' }, () => {
    assert.throws(
      () => getProviderTimeoutMs(),
      /NOQ_PROVIDER_TIMEOUT_MS must be an integer greater than or equal to 1000/,
    );
  });

  withRuntimeEnv({ NOQ_PROVIDER_MAX_TOOL_ROUNDS: '0' }, () => {
    assert.throws(
      () => getProviderMaxToolRounds(),
      /NOQ_PROVIDER_MAX_TOOL_ROUNDS must be an integer greater than or equal to 1/,
    );
  });
});

test('debugLog writes to stderr only when debug logging is enabled', () => {
  const originalError = console.error;
  const messages: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args);
  };

  try {
    withRuntimeEnv({}, () => {
      debugLog('hidden');
    });

    withRuntimeEnv({ NOQ_DEBUG: 'true' }, () => {
      debugLog('visible', 123);
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(messages, [['visible', 123]]);
});
