import assert from 'node:assert/strict';
import test from 'node:test';

import { capToolOutput } from '../src/providers/shared/toolOutput';

test('capToolOutput leaves short output unchanged', () => {
  const output = 'small output';
  assert.equal(capToolOutput(output, 100), output);
});

test('capToolOutput keeps the head and tail and marks the truncation', () => {
  const output = 'A'.repeat(500) + 'TAIL_MARKER';
  const capped = capToolOutput(output, 100);

  assert.ok(capped.length < output.length);
  assert.ok(capped.startsWith('A'));
  assert.ok(capped.includes('characters truncated'));
  // The tail is preserved so trailing summaries/errors survive.
  assert.ok(capped.includes('TAIL_MARKER'));
});
