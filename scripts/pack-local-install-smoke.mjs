import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapperDir = path.join(rootDir, 'packages', 'noq-agent');
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
);
const expectedVersion = rootPackageJson.version;
const packageMap = {
  'win32-x64': 'noq-agent-windows-x64',
  'darwin-arm64': 'noq-agent-darwin-arm64',
  'darwin-x64': 'noq-agent-darwin-x64',
  'linux-x64': 'noq-agent-linux-x64',
  'linux-arm64': 'noq-agent-linux-arm64',
};

function run(command, args, cwd) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd,
        encoding: 'utf8',
      })
    : spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
      });

  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || `${command} failed with ${result.status}`);
  }

  return result.stdout.trim();
}

const packageName = packageMap[`${process.platform}-${process.arch}`];
if (!packageName) {
  throw new Error(`Unsupported local smoke-test platform: ${process.platform}-${process.arch}`);
}

const platformDir = path.join(rootDir, 'packages', packageName);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-pack-smoke-'));

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const wrapperTarball = run(npmCommand, ['pack', wrapperDir], rootDir)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);
const platformTarball = run(npmCommand, ['pack', platformDir], rootDir)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);

if (!wrapperTarball || !platformTarball) {
  throw new Error('Failed to resolve packed tarball names.');
}

fs.writeFileSync(
  path.join(tempDir, 'package.json'),
  JSON.stringify({
    name: 'noq-agent-pack-smoke',
    private: true,
    version: '1.0.0',
  }, null, 2),
);

run(npmCommand, ['install', path.join(rootDir, wrapperTarball), path.join(rootDir, platformTarball)], tempDir);

const noqBin = process.platform === 'win32'
  ? path.join(tempDir, 'node_modules', '.bin', 'noq.cmd')
  : path.join(tempDir, 'node_modules', '.bin', 'noq');

const versionOutput = run(noqBin, ['--version'], tempDir);
const helpOutput = run(noqBin, ['--help'], tempDir);

if (versionOutput !== expectedVersion) {
  throw new Error(`Expected version ${expectedVersion}, received ${versionOutput}`);
}

if (!helpOutput.includes('noq-agent - local AI coding agent CLI')) {
  throw new Error('Smoke test help output did not contain the CLI banner.');
}

fs.rmSync(tempDir, { recursive: true, force: true });
console.log(`Local npm pack smoke test passed for ${packageName}.`);
