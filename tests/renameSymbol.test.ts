import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRenamePlan, planRenameSymbol } from '../src/analysis/renameService';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('renameSymbol renames a TypeScript function across files without touching unrelated locals', async () => {
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
    workspace.writeFile('c.ts', [
      'export function unrelated(): number {',
      '  const add = 5;',
      '  return add;',
      '}',
      '',
    ].join('\n'));

    const edits = planRenameSymbol({
      filePath: 'a.ts',
      line: 1,
      symbol: 'add',
      newName: 'sum',
    });

    const changedRelativePaths = edits.map((edit) => edit.relativeFilePath).sort();
    assert.deepEqual(changedRelativePaths, ['a.ts', 'b.ts']);

    applyRenamePlan(edits);

    const aContent = workspace.readFile('a.ts');
    const bContent = workspace.readFile('b.ts');
    const cContent = workspace.readFile('c.ts');

    assert.match(aContent, /export function sum\(/);
    assert.doesNotMatch(aContent, /\badd\b/);
    assert.match(bContent, /import \{ sum \} from '\.\/a'/);
    assert.match(bContent, /sum\(1, 2\)/);
    assert.match(cContent, /const add = 5;/);
  });
});

test('renameSymbol throws for Java (no semantic engine available)', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('Main.java', [
      'public class Main {',
      '  public static int add(int x, int y) {',
      '    return x + y;',
      '  }',
      '}',
      '',
    ].join('\n'));

    assert.throws(
      () => planRenameSymbol({
        filePath: 'Main.java',
        line: 2,
        symbol: 'add',
        newName: 'sum',
      }),
      /not supported for Java/,
    );
  });
});

test('renameSymbol throws for Go (not supported yet)', async () => {
  await withTempWorkspace(async (workspace) => {
    workspace.writeFile('main.go', [
      'package main',
      '',
      'func add(x int, y int) int {',
      '  return x + y',
      '}',
      '',
    ].join('\n'));

    assert.throws(
      () => planRenameSymbol({
        filePath: 'main.go',
        line: 3,
        symbol: 'add',
        newName: 'sum',
      }),
      /not supported for Go/,
    );
  });
});
