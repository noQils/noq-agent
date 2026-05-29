import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { applyPatch } from '../src/tools/applyPatch';
import { editFile } from '../src/tools/editFile';
import { readFile } from '../src/tools/readFile';
import { writeFile } from '../src/tools/writeFile';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('readFile returns a formatted 1-based line range', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('notes.txt', 'alpha\nbeta\ngamma\n');

    const output = readFile('notes.txt', 2, 3);

    assert.equal(output, [
      'File: notes.txt',
      'Lines: 2-3',
      '',
      '2 | beta',
      '3 | gamma',
    ].join('\n'));
  });
});

test('writeFile creates nested files and rejects existing files', async () => {
  await withTempWorkspace((workspace) => {
    assert.equal(writeFile('src/generated.txt', 'hello\n'), 'Created file: src/generated.txt');
    assert.equal(workspace.readFile('src/generated.txt'), 'hello\n');

    assert.throws(
      () => writeFile('src/generated.txt', 'again\n'),
      /File already exists: src\/generated\.txt/,
    );
  });
});

test('writeFile succeeds when the parent directory already exists', async () => {
  await withTempWorkspace((workspace) => {
    fs.mkdirSync(path.join(workspace.root, 'src'), { recursive: true });

    assert.equal(writeFile('src/already-parented.txt', 'hello\n'), 'Created file: src/already-parented.txt');
    assert.equal(workspace.readFile('src/already-parented.txt'), 'hello\n');
  });
});

test('editFile replaces a unique exact match', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('src/example.ts', 'const value = 1;\n');

    const output = editFile('src/example.ts', 'value = 1', 'value = 2');

    assert.equal(output, 'Updated src/example.ts by replacing 1 exact text match.');
    assert.equal(workspace.readFile('src/example.ts'), 'const value = 2;\n');
  });
});

test('editFile rejects ambiguous matches', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('duplicates.txt', 'same\nsame\n');

    assert.throws(
      () => editFile('duplicates.txt', 'same', 'different'),
      /matched 2 times/,
    );
  });
});

test('applyPatch applies add and update operations', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('target.txt', 'one\ntwo\nthree\n');

    const output = applyPatch([
      '*** Begin Patch',
      '*** Add File: created.txt',
      '+hello',
      '+world',
      '*** Update File: target.txt',
      '@@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '*** End Patch',
    ].join('\n'));

    assert.equal(output, [
      'Applied patch:',
      '- Created created.txt',
      '- Updated target.txt',
    ].join('\n'));
    assert.equal(workspace.readFile('created.txt'), 'hello\nworld\n');
    assert.equal(workspace.readFile('target.txt'), 'one\nTWO\nthree\n');
  });
});

test('applyPatch rejects missing update context without changing the file', async () => {
  await withTempWorkspace((workspace) => {
    workspace.writeFile('target.txt', 'one\ntwo\nthree\n');

    assert.throws(
      () => applyPatch([
        '*** Begin Patch',
        '*** Update File: target.txt',
        '@@',
        ' missing',
        '-two',
        '+TWO',
        '*** End Patch',
      ].join('\n')),
      /Patch context was not found/,
    );
    assert.equal(workspace.readFile('target.txt'), 'one\ntwo\nthree\n');
  });
});
