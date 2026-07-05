import assert from 'node:assert/strict';
import test from 'node:test';

import { runProviderRequest } from '../src/providers/shared/providerRuntime';

function withMaxRetries<T>(value: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.NOQ_PROVIDER_MAX_RETRIES;
  process.env.NOQ_PROVIDER_MAX_RETRIES = value;
  const restore = (): void => {
    if (previous === undefined) {
      delete process.env.NOQ_PROVIDER_MAX_RETRIES;
    } else {
      process.env.NOQ_PROVIDER_MAX_RETRIES = previous;
    }
  };

  return callback().finally(restore);
}

test('runProviderRequest returns successful provider results', async () => {
  const result = await runProviderRequest(
    'FakeProvider',
    'complete',
    async () => 'ok',
    50,
  );

  assert.equal(result, 'ok');
});

test('runProviderRequest adds provider context to request failures', async () => {
  await assert.rejects(
    () => runProviderRequest(
      'FakeProvider',
      'complete',
      async () => {
        throw new Error('upstream exploded');
      },
      50,
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'FakeProvider complete failed: upstream exploded');
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, 'upstream exploded');
      return true;
    },
  );
});

test('runProviderRequest times out slow provider requests', async () => {
  await assert.rejects(
    () => runProviderRequest(
      'FakeProvider',
      'complete',
      () => new Promise((resolve) => {
        setTimeout(() => resolve('late'), 25);
      }),
      5,
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'FakeProvider complete timed out after 5ms.');
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, 'FakeProvider complete timed out after 5ms.');
      return true;
    },
  );
});

test('runProviderRequest retries retryable errors and then succeeds', async () => {
  await withMaxRetries('3', async () => {
    let calls = 0;
    const result = await runProviderRequest(
      'FakeProvider',
      'complete',
      () => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error('rate limited'), { status: 429 });
        }
        return 'ok';
      },
      1000,
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });
});

test('runProviderRequest does not retry non-retryable errors', async () => {
  await withMaxRetries('3', async () => {
    let calls = 0;
    await assert.rejects(
      () => runProviderRequest(
        'FakeProvider',
        'complete',
        () => {
          calls++;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        1000,
      ),
      /FakeProvider complete failed: bad request/,
    );

    assert.equal(calls, 1);
  });
});

test('runProviderRequest aborts the request and does not retry on timeout', async () => {
  await withMaxRetries('3', async () => {
    let sawAbort = false;
    let calls = 0;
    await assert.rejects(
      () => runProviderRequest(
        'FakeProvider',
        'complete',
        (signal) => {
          calls++;
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              sawAbort = true;
              reject(new Error('aborted'));
            });
          });
        },
        5,
      ),
      /FakeProvider complete timed out after 5ms\./,
    );

    assert.equal(sawAbort, true);
    assert.equal(calls, 1);
  });
});
