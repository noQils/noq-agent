/// <reference types="bun" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import solidPlugin from '@opentui/solid/bun-plugin';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = {
  'windows-x64': {
    bunTarget: 'bun-windows-x64',
    packageDir: path.join(rootDir, 'packages', 'noq-agent-windows-x64'),
    outputName: 'noq-agent.exe',
  },
  'darwin-arm64': {
    bunTarget: 'bun-darwin-arm64',
    packageDir: path.join(rootDir, 'packages', 'noq-agent-darwin-arm64'),
    outputName: 'noq-agent',
  },
  'darwin-x64': {
    bunTarget: 'bun-darwin-x64',
    packageDir: path.join(rootDir, 'packages', 'noq-agent-darwin-x64'),
    outputName: 'noq-agent',
  },
  'linux-x64': {
    bunTarget: 'bun-linux-x64',
    packageDir: path.join(rootDir, 'packages', 'noq-agent-linux-x64'),
    outputName: 'noq-agent',
  },
  'linux-arm64': {
    bunTarget: 'bun-linux-arm64',
    packageDir: path.join(rootDir, 'packages', 'noq-agent-linux-arm64'),
    outputName: 'noq-agent',
  },
} as const;

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

const currentPlatformId = process.platform === 'win32' ? 'windows' : process.platform;
const currentTargetId = `${currentPlatformId}-${process.arch}`;
const targetId = getArgValue('--target') ?? currentTargetId;
if (!(targetId in targets)) {
  throw new Error(`Unknown target "${targetId}". Expected one of: ${Object.keys(targets).join(', ')}`);
}

const target = targets[targetId as keyof typeof targets];
const distDir = path.join(rootDir, 'dist', 'runtime', targetId);
const outfile = path.join(distDir, target.outputName);
const binDir = path.join(target.packageDir, 'bin');
const packagedBinaryPath = path.join(binDir, target.outputName);

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(rootDir, 'src', 'runtimeExecutable.ts')],
  target: 'bun',
  format: 'esm',
  sourcemap: 'none',
  plugins: [solidPlugin],
  compile: {
    target: target.bunTarget,
    outfile,
  },
});

if (!result.success) {
  throw new Error('Bun runtime build failed.');
}

fs.copyFileSync(outfile, packagedBinaryPath);
if (process.platform !== 'win32') {
  fs.chmodSync(packagedBinaryPath, 0o755);
}

console.log(`Built ${targetId} runtime: ${packagedBinaryPath}`);
