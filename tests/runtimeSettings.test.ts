import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  debugLog,
  defaultMaxFlowRounds,
  defaultMaxToolOutputChars,
  defaultProviderMaxRetries,
  defaultProviderMaxToolRounds,
  defaultProviderTimeoutMs,
  getDebugLogFilePath,
  getMaxFlowRounds,
  getMaxToolOutputChars,
  getProviderMaxRetries,
  getProviderMaxToolRounds,
  getProviderTimeoutMs,
  getRuntimeSettings,
  isDebugLoggingEnabled,
  setDebugLogFilePath,
} from '../src/config/runtimeSettings';
import { resetRuntimeEnvironmentForTests } from '../src/runtimeEnv';

const settingNames = [
  'NOQ_DEBUG',
  'NOQ_PROVIDER_TIMEOUT_MS',
  'NOQ_PROVIDER_MAX_TOOL_ROUNDS',
  'NOQ_PROVIDER_MAX_RETRIES',
  'NOQ_MAX_FLOW_ROUNDS',
  'NOQ_MAX_TOOL_OUTPUT_CHARS',
  'NOQ_DEBUG_LOG_MAX_BYTES',
];

function withRuntimeEnv(values: Record<string, string>, callback: () => void): void {
  const previousCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-runtime-env-test-'));
  const envNames = [...settingNames, 'NOQ_HOME'];
  const previousValues = new Map<string, string | undefined>();
  const previousDebugLogFilePath = getDebugLogFilePath();

  for (const name of envNames) {
    previousValues.set(name, process.env[name]);
    delete process.env[name];
  }

  process.chdir(root);
  process.env.NOQ_HOME = path.join(root, '.noq-home');
  setDebugLogFilePath(null);

  for (const [name, value] of Object.entries(values)) {
    process.env[name] = value;
  }

  resetRuntimeEnvironmentForTests();

  try {
    callback();
  } finally {
    process.chdir(previousCwd);

    for (const name of envNames) {
      const previousValue = previousValues.get(name);
      if (previousValue === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousValue;
      }
    }

    resetRuntimeEnvironmentForTests();
    setDebugLogFilePath(previousDebugLogFilePath);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('runtime settings use quiet defaults', () => {
  withRuntimeEnv({}, () => {
    assert.equal(defaultProviderMaxToolRounds, 40);
    assert.deepEqual(getRuntimeSettings(), {
      debug: false,
      providerTimeoutMs: defaultProviderTimeoutMs,
      providerMaxToolRounds: defaultProviderMaxToolRounds,
      providerMaxRetries: defaultProviderMaxRetries,
      maxFlowRounds: defaultMaxFlowRounds,
      maxToolOutputChars: defaultMaxToolOutputChars,
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
    NOQ_PROVIDER_MAX_RETRIES: '5',
    NOQ_MAX_FLOW_ROUNDS: '12',
    NOQ_MAX_TOOL_OUTPUT_CHARS: '4096',
  }, () => {
    assert.equal(getProviderTimeoutMs(), 2500);
    assert.equal(getProviderMaxToolRounds(), 3);
    assert.equal(getProviderMaxRetries(), 5);
    assert.equal(getMaxFlowRounds(), 12);
    assert.equal(getMaxToolOutputChars(), 4096);
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

test('debugLog writes to stderr when debug logging is enabled and no file is active', () => {
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

test('debugLog appends to the active debug log file instead of stderr', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-debug-log-test-'));
  const logFilePath = path.join(root, '.noq', 'sessions', 'debug-session', 'debug.log');
  const originalError = console.error;
  const messages: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    messages.push(args);
  };

  try {
    withRuntimeEnv({ NOQ_DEBUG: 'true' }, () => {
      setDebugLogFilePath(logFilePath);
      debugLog('visible', { value: 123 });
    });

    assert.deepEqual(messages, []);
    assert.match(fs.readFileSync(logFilePath, 'utf-8'), /^\[[^\]]+\] visible \{ value: 123 \}\n$/);
  } finally {
    console.error = originalError;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('debugLog rotates the active file once it exceeds the size limit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-debug-log-rotate-test-'));
  const logFilePath = path.join(root, 'debug.log');

  try {
    withRuntimeEnv({ NOQ_DEBUG: 'true', NOQ_DEBUG_LOG_MAX_BYTES: '1024' }, () => {
      setDebugLogFilePath(logFilePath);
      // Each line is well over 1KB, so the second write forces a rotation.
      debugLog('A'.repeat(2000));
      debugLog('B'.repeat(2000));
    });

    assert.ok(fs.existsSync(`${logFilePath}.1`), 'expected a rotated .1 backup to exist');
    assert.match(fs.readFileSync(`${logFilePath}.1`, 'utf-8'), /AAAA/);
    // The live file holds only the most recent line.
    const current = fs.readFileSync(logFilePath, 'utf-8');
    assert.match(current, /BBBB/);
    assert.ok(!current.includes('AAAA'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('debugLog does not create the active file when debug logging is disabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-debug-log-disabled-test-'));
  const logFilePath = path.join(root, 'debug.log');

  try {
    withRuntimeEnv({}, () => {
      setDebugLogFilePath(logFilePath);
      debugLog('hidden');
    });

    assert.equal(fs.existsSync(logFilePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
