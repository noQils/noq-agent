import assert from 'node:assert/strict';
import test from 'node:test';

import { runProviderRequest } from '../src/providers/shared/providerRuntime';

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
