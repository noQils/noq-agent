import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import dotenv from 'dotenv';

const workspaceEnvFileNames = [
  path.join('.noq-agent', '.env'),
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

export function getNoqHomeDirectory(): string {
  const override = process.env.NOQ_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(os.homedir(), '.noq-agent');
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

export function initializeRuntimeEnvironment(): void {
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

export function getLoadedEnvFiles(): string[] {
  initializeRuntimeEnvironment();
  return [...loadedEnvFiles];
}

export function getRuntimeEnvVar(name: string): string | undefined {
  initializeRuntimeEnvironment();
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function getRequiredRuntimeEnvVar(name: string, label?: string): string {
  const value = getRuntimeEnvVar(name);
  if (!value) {
    throw new Error(
      `${label ?? name} is not configured. ` +
      `Set it in your shell environment, ${path.join(getNoqHomeDirectory(), '.env')}, ` +
      `or a workspace file like .noq-agent/.env.`,
    );
  }

  return value;
}

export function resetRuntimeEnvironmentForTests(): void {
  runtimeEnvironmentInitialized = false;
  loadedEnvFiles = [];
}
