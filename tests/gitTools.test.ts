import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { gitDiff, gitStatus } from '../src/tools/git';
import { withTempWorkspace } from './helpers/tempWorkspace';

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function initRepo(cwd: string): void {
  git(['init'], cwd);
  git(['config', 'user.email', 'test@example.com'], cwd);
  git(['config', 'user.name', 'Test User'], cwd);
}

test('gitStatus reports a clean working tree', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('README.md', 'hello\n');
    git(['add', 'README.md'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    const output = await gitStatus();
    assert.match(output, /Working tree clean\./);
  });
});

test('gitStatus lists modified and untracked files', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('README.md', 'hello\n');
    git(['add', 'README.md'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    workspace.writeFile('README.md', 'hello again\n');
    workspace.writeFile('new-file.txt', 'new\n');

    const output = await gitStatus();
    assert.match(output, /README\.md/);
    assert.match(output, /new-file\.txt/);
  });
});

test('gitDiff shows unstaged changes by default', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('README.md', 'hello\n');
    git(['add', 'README.md'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    workspace.writeFile('README.md', 'hello again\n');

    const output = await gitDiff();
    assert.match(output, /-hello/);
    assert.match(output, /\+hello again/);
  });
});

test('gitDiff with staged shows only staged changes', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('README.md', 'hello\n');
    git(['add', 'README.md'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    workspace.writeFile('README.md', 'staged change\n');
    git(['add', 'README.md'], workspace.root);
    workspace.writeFile('README.md', 'unstaged on top\n');

    const stagedDiff = await gitDiff({ staged: true });
    assert.match(stagedDiff, /\+staged change/);
    assert.doesNotMatch(stagedDiff, /unstaged on top/);
  });
});

test('gitDiff with path scopes to a single file', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('a.txt', 'a\n');
    workspace.writeFile('b.txt', 'b\n');
    git(['add', '.'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    workspace.writeFile('a.txt', 'a changed\n');
    workspace.writeFile('b.txt', 'b changed\n');

    const output = await gitDiff({ path: 'a.txt' });
    assert.match(output, /a\.txt/);
    assert.doesNotMatch(output, /b\.txt/);
  });
});

test('gitDiff returns "No changes." when there is nothing to diff', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('README.md', 'hello\n');
    git(['add', 'README.md'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    const output = await gitDiff();
    assert.equal(output, 'No changes.');
  });
});

test('gitDiff truncates very large diffs', async () => {
  await withTempWorkspace(async (workspace) => {
    initRepo(workspace.root);
    workspace.writeFile('big.txt', '');
    git(['add', 'big.txt'], workspace.root);
    git(['commit', '-m', 'initial'], workspace.root);

    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
    workspace.writeFile('big.txt', lines + '\n');

    const output = await gitDiff();
    assert.match(output, /\.\.\.\[truncated\]$/);
  });
});

test('gitStatus throws a clear error outside a git repository', async () => {
  await withTempWorkspace(async () => {
    await assert.rejects(
      () => gitStatus(),
      /not a git repository/i,
    );
  });
});

test('gitDiff throws a clear error outside a git repository', async () => {
  await withTempWorkspace(async () => {
    await assert.rejects(
      () => gitDiff(),
      /not a git repository/i,
    );
  });
});
