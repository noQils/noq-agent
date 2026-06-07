import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { getNoqHomeDirectory } from './config/noqHome';

const workspaceEnvFileNames = [
  path.join('.noq', '.env'),
  'noq-agent.env',
];

let runtimeEnvironmentInitialized = false;
let loadedEnvFiles: string[] = [];

function getPackageRoot(): string {
  return path.resolve(__dirname, '..');
}

function isCurrentWorkspaceInsidePackageRoot(): boolean {
  const packageRoot = getPackageRoot();
  const relativePath = path.relative(packageRoot, process.cwd());

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function getCandidateEnvFiles(): string[] {
  const candidates = [
    ...workspaceEnvFileNames.map((relativePath) => path.resolve(process.cwd(), relativePath)),
    path.resolve(getNoqHomeDirectory(), '.env'),
  ];

  if (isCurrentWorkspaceInsidePackageRoot()) {
    candidates.push(path.resolve(getPackageRoot(), '.env'));
  }

  return Array.from(new Set(candidates));
}

function initializeRuntimeEnvironment(): void {
  if (runtimeEnvironmentInitialized) {
    return;
  }

  loadedEnvFiles = [];

  for (const envFilePath of getCandidateEnvFiles()) {
    if (!fs.existsSync(envFilePath)) {
      continue;
    }

    dotenv.config({
      path: envFilePath,
      override: false,
      quiet: true,
    });
    loadedEnvFiles.push(envFilePath);
  }

  runtimeEnvironmentInitialized = true;
}

export function getRuntimeEnvVar(name: string): string | undefined {
  initializeRuntimeEnvironment();
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function resetRuntimeEnvironmentForTests(): void {
  runtimeEnvironmentInitialized = false;
  loadedEnvFiles = [];
}
