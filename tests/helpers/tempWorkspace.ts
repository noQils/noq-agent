import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resetConfigCache } from '../../src/config';

export interface TempWorkspace {
  root: string;
  path: (...segments: string[]) => string;
  writeFile: (filePath: string, content: string) => void;
  readFile: (filePath: string) => string;
}

export async function withTempWorkspace<T>(
  callback: (workspace: TempWorkspace) => Promise<T> | T,
): Promise<T> {
  const previousCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-test-'));

  const workspace: TempWorkspace = {
    root,
    path: (...segments) => path.join(root, ...segments),
    writeFile: (filePath, content) => {
      const resolvedPath = path.join(root, filePath);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf-8');
    },
    readFile: (filePath) => fs.readFileSync(path.join(root, filePath), 'utf-8'),
  };

  try {
    process.chdir(root);
    resetConfigCache();
    return await callback(workspace);
  } finally {
    process.chdir(previousCwd);
    resetConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
