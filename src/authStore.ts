import fs from 'node:fs';

import { ensureNoqHomeDirectory, getAuthStorePath } from './noqHome';
import { providerNames, type ProviderName } from './providers/types';

export interface ProviderAuthRecord {
  apiKey?: string;
  baseUrl?: string;
  httpReferer?: string;
  appTitle?: string;
}

export type AuthStore = Partial<Record<ProviderName, ProviderAuthRecord>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function readAuthStoreFile(authStorePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(authStorePath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${authStorePath}: ${message}`);
  }
}

function normalizeProviderAuthRecord(value: unknown): ProviderAuthRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const apiKey = normalizeString(value.apiKey);
  const baseUrl = normalizeString(value.baseUrl);
  const httpReferer = normalizeString(value.httpReferer);
  const appTitle = normalizeString(value.appTitle);

  const normalizedRecord: ProviderAuthRecord = {
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(httpReferer ? { httpReferer } : {}),
    ...(appTitle ? { appTitle } : {}),
  };

  return Object.keys(normalizedRecord).length > 0 ? normalizedRecord : {};
}

function normalizeAuthStore(rawStore: unknown, authStorePath: string): AuthStore {
  if (!isRecord(rawStore)) {
    throw new Error(`${authStorePath} must contain a JSON object.`);
  }

  const normalizedStore: AuthStore = {};
  for (const providerName of providerNames) {
    const normalizedRecord = normalizeProviderAuthRecord(rawStore[providerName]);
    if (normalizedRecord) {
      normalizedStore[providerName] = normalizedRecord;
    }
  }

  return normalizedStore;
}

export function loadAuthStore(): AuthStore {
  const authStorePath = getAuthStorePath();
  if (!fs.existsSync(authStorePath)) {
    return {};
  }

  return normalizeAuthStore(readAuthStoreFile(authStorePath), authStorePath);
}

export function saveAuthStore(store: AuthStore): void {
  ensureNoqHomeDirectory();
  fs.writeFileSync(getAuthStorePath(), `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}
