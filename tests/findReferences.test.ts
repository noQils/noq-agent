import assert from 'node:assert/strict';
import test from 'node:test';

import { findReferences } from '../src/analysis/referencesService';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('findReferences finds usages of a TypeScript function across files', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('a.ts', [
      'export function add(x: number, y: number): number {',
      '  return x + y;',
      '}',
      '',
    ].join('\n'));
    workspace.writeFile('b.ts', [
      "import { add } from './a';",
      '',
      'const result = add(1, 2);',
      '',
    ].join('\n'));

    const references = findReferences({
      filePath: 'a.ts',
      line: 1,
      symbol: 'add',
    });

    const filePaths = references.map((reference) => reference.filePath).sort();
    assert.ok(filePaths.includes('a.ts'));
    assert.ok(filePaths.includes('b.ts'));
  });
});

test('findReferences throws for an unsupported file type', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('notes.txt', 'hello\n');

    assert.throws(
      () => findReferences({ filePath: 'notes.txt', line: 1, symbol: 'hello' }),
      /Unsupported file type/,
    );
  });
});

test('findReferences on Java scans all occurrences by regex', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('Main.java', [
      'public class Main {',
      '  public static int add(int x, int y) {',
      '    return x + y;',
      '  }',
      '',
      '  public static void main(String[] args) {',
      '    int result = add(1, 2);',
      '  }',
      '}',
      '',
    ].join('\n'));

    const references = findReferences({
      filePath: 'Main.java',
      line: 2,
      symbol: 'add',
    });

    assert.ok(references.length >= 2);
    assert.ok(references.some((reference) => reference.line === 7));
  });
});
