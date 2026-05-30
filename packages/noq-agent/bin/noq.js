#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const platformPackages = {
  'win32-x64': {
    packageName: 'noq-agent-windows-x64',
    executableName: 'noq-agent.exe',
  },
  'darwin-arm64': {
    packageName: 'noq-agent-darwin-arm64',
    executableName: 'noq-agent',
  },
  'darwin-x64': {
    packageName: 'noq-agent-darwin-x64',
    executableName: 'noq-agent',
  },
  'linux-x64': {
    packageName: 'noq-agent-linux-x64',
    executableName: 'noq-agent',
  },
  'linux-arm64': {
    packageName: 'noq-agent-linux-arm64',
    executableName: 'noq-agent',
  },
};

function resolvePlatformPackage() {
  return platformPackages[`${process.platform}-${process.arch}`] ?? null;
}

function resolveExecutablePath() {
  const platformPackage = resolvePlatformPackage();
  if (!platformPackage) {
    throw new Error(
      `Unsupported platform ${process.platform}-${process.arch}. ` +
      'noq-agent currently ships windows-x64, darwin-arm64, darwin-x64, linux-x64, and linux-arm64 runtime packages.',
    );
  }

  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${platformPackage.packageName}/package.json`);
  } catch (error) {
    throw new Error(
      `The runtime package ${platformPackage.packageName} is not installed. ` +
      'Reinstall noq-agent or install on a supported platform.',
      { cause: error },
    );
  }

  const packageDir = path.dirname(packageJsonPath);
  const executablePath = path.join(packageDir, 'bin', platformPackage.executableName);

  if (!fs.existsSync(executablePath)) {
    throw new Error(`The runtime executable is missing: ${executablePath}`);
  }

  return executablePath;
}

async function main() {
  const executablePath = resolveExecutablePath();
  const child = spawn(executablePath, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: false,
  });

  child.once('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
