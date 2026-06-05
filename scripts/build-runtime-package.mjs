import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const result = spawnSync(
  process.platform === 'win32' ? 'bun.exe' : 'bun',
  ['run', './scripts/build-runtime-package.ts', ...args],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

if (result.status !== 0) {
  throw new Error(`bun run ./scripts/build-runtime-package.ts ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
}
