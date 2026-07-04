import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePatch } from 'diff';

import { buildSessionFileDiff } from '../src/session/sessionDiff';

// The installed diff@4 runtime validates hunk line counts only when passed
// { strict: true }, but @types/diff@7 no longer declares the options
// parameter, so widen the signature for the strict call.
const parsePatchStrict = parsePatch as unknown as (
  source: string,
  options?: { strict?: boolean },
) => unknown[];
import { type SessionFileChange } from '../src/session/sessionChangeTracker';

const beforeContent = [
  'function del() {',
  '  const result = store.delete(id);',
  '  if (result) {',
  '    log(id);',
  '  }',
  '  return result;',
  '}',
  '',
  'function next() {}',
  '',
].join('\n');

const afterContent = [
  'function del() {',
  '  const result = store.delete(id);',
  '  if (!result) {',
  '    throw new NotFoundError(id);',
  '  }',
  '  log(id);',
  '  return result;',
  '}',
  '',
  'function next() {}',
  '',
].join('\n');

const fileChange: SessionFileChange = {
  filePath: 'src/user-service.ts',
  existedBefore: true,
  beforeContent,
  existedAfter: true,
  afterContent,
};

test('buildSessionFileDiff keeps a trailing blank context line intact', () => {
  const diff = buildSessionFileDiff([fileChange]);

  // The last hunk ends on a blank source line, which unified diff renders as a
  // single-space line. It must survive sanitization or hunk line counts break.
  assert.ok(diff.endsWith('\n '), 'diff should end with the space-only context line');
});

test('buildSessionFileDiff output satisfies strict unified diff parsing', () => {
  const diff = buildSessionFileDiff([fileChange]);

  assert.doesNotThrow(() => parsePatchStrict(diff, { strict: true }));
});
