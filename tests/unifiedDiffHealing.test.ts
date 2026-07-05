import assert from 'node:assert/strict';
import test from 'node:test';

import { healUnifiedDiffForRender, parseUnifiedDiffStrict } from '../src/opentui/unifiedDiffHealing';

// Mirrors the real-world corruption: the last hunk ended on a blank context
// line (a space-only line), which was trimmed away in storage, so the body has
// one line fewer per side than the @@ header promises.
const truncatedTrailingContextDiff = [
  'diff --git a/services/user-service.ts b/services/user-service.ts',
  'index 2ed3ec6..b57493b 100644',
  '--- a/services/user-service.ts',
  '+++ b/services/user-service.ts',
  '@@ -101,9 +101,10 @@ export class UserService {',
  '       throw new Error(`Cannot delete user.`);',
  '     }',
  '     const result = this.userStore.delete(id);',
  '-    if (result) {',
  '-      this.logger.info(`Deleted user`);',
  '+    if (!result) {',
  "+      throw new NotFoundError('User', id);",
  '     }',
  '+    this.logger.info(`Deleted user`);',
  '     return result;',
  '   }',
].join('\n');

test('parseUnifiedDiffStrict rejects hunks whose line counts do not match the header', () => {
  assert.throws(
    () => parseUnifiedDiffStrict(truncatedTrailingContextDiff),
    /line count did not match/,
  );
});

test('healUnifiedDiffForRender rewrites hunk headers to match the actual body', () => {
  const healedDiff = healUnifiedDiffForRender(truncatedTrailingContextDiff);

  assert.ok(
    healedDiff.includes('@@ -101,8 +101,9 @@ export class UserService {'),
    'header should be recomputed from the truncated body',
  );
  assert.doesNotThrow(() => parseUnifiedDiffStrict(healedDiff));
});

test('healUnifiedDiffForRender restores blank context lines that lost their leading space', () => {
  const diffWithBareBlankLine = [
    'diff --git a/sample.txt b/sample.txt',
    '--- a/sample.txt',
    '+++ b/sample.txt',
    '@@ -1,3 +1,3 @@',
    ' first',
    '',
    '-second',
    '+SECOND',
  ].join('\n');

  const healedDiff = healUnifiedDiffForRender(diffWithBareBlankLine);

  assert.ok(healedDiff.includes('\n \n'), 'bare blank line should become a context line');
  assert.ok(healedDiff.includes('@@ -1,3 +1,3 @@'), 'header counts should stay consistent');
  assert.doesNotThrow(() => parseUnifiedDiffStrict(healedDiff));
});

test('healUnifiedDiffForRender leaves valid diffs semantically unchanged', () => {
  const validDiff = [
    'diff --git a/sample.txt b/sample.txt',
    'index 0000001..0000002 100644',
    '--- a/sample.txt',
    '+++ b/sample.txt',
    '@@ -1,2 +1,2 @@',
    ' unchanged',
    '-old',
    '+new',
  ].join('\n');

  const healedDiff = healUnifiedDiffForRender(validDiff);

  assert.equal(healedDiff, validDiff);
  assert.doesNotThrow(() => parseUnifiedDiffStrict(healedDiff));
});
