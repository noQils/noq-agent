import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getNoqHomeDirectory(): string {
  const override = process.env.NOQ_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.join(os.homedir(), '.noq');
}

export function ensureNoqHomeDirectory(): string {
  const homeDirectory = getNoqHomeDirectory();
  fs.mkdirSync(homeDirectory, { recursive: true });
  return homeDirectory;
}

export function getNoqHomeFilePath(fileName: string): string {
  return path.resolve(getNoqHomeDirectory(), fileName);
}

export function getGlobalConfigPath(): string {
  return getNoqHomeFilePath('config.json');
}

export function getAuthStorePath(): string {
  return getNoqHomeFilePath('auth.json');
}

export function getGlobalSessionsDirectoryPath(): string {
  return getNoqHomeFilePath('sessions');
}
