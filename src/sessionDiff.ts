import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { type SessionFileChange } from './sessionChangeTracker';

function writeSnapshotSide(
  targetDirectory: string,
  fileChanges: SessionFileChange[],
  side: 'before' | 'after',
): void {
  for (const change of fileChanges) {
    const exists = side === 'before' ? change.existedBefore : change.existedAfter;
    if (!exists) {
      continue;
    }

    const content = side === 'before'
      ? change.beforeContent ?? ''
      : change.afterContent ?? '';
    const targetPath = path.join(targetDirectory, change.filePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf-8');
  }
}

function buildFallbackDiff(fileChanges: SessionFileChange[]): string {
  const lines = fileChanges.map((change) => {
    if (!change.existedBefore && change.existedAfter) {
      return `created ${change.filePath}`;
    }

    if (change.existedBefore && !change.existedAfter) {
      return `deleted ${change.filePath}`;
    }

    return `modified ${change.filePath}`;
  });

  return `Git diff unavailable. Changed files:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function sanitizeGitBackedDiff(diff: string): string {
  return diff
    .replaceAll('a/before/', 'a/')
    .replaceAll('a/after/', 'a/')
    .replaceAll('b/before/', 'b/')
    .replaceAll('b/after/', 'b/')
    .trim();
}

export function buildSessionFileDiff(fileChanges: SessionFileChange[]): string {
  if (fileChanges.length === 0) {
    return '';
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-session-diff-'));
  const beforeDirectory = path.join(tempRoot, 'before');
  const afterDirectory = path.join(tempRoot, 'after');
  fs.mkdirSync(beforeDirectory, { recursive: true });
  fs.mkdirSync(afterDirectory, { recursive: true });

  try {
    writeSnapshotSide(beforeDirectory, fileChanges, 'before');
    writeSnapshotSide(afterDirectory, fileChanges, 'after');

    const diffResult = spawnSync(
      'git',
      ['diff', '--no-index', '--src-prefix=a/', '--dst-prefix=b/', 'before', 'after'],
      {
        cwd: tempRoot,
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    if (diffResult.error || (diffResult.status !== 0 && diffResult.status !== 1)) {
      return buildFallbackDiff(fileChanges);
    }

    const sanitizedDiff = sanitizeGitBackedDiff(diffResult.stdout);
    return sanitizedDiff.length > 0 ? sanitizedDiff : buildFallbackDiff(fileChanges);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
