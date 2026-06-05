import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

import { getRuntimeEnvVar } from './runtimeEnv';

export const defaultProviderTimeoutMs = 180_000;
export const defaultProviderMaxToolRounds = 10;
export const minProviderTimeoutMs = 1_000;
export const minProviderMaxToolRounds = 1;

export interface RuntimeSettings {
  debug: boolean;
  providerTimeoutMs: number;
  providerMaxToolRounds: number;
}

let debugLogFilePath: string | null = null;

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseIntegerSetting(name: string, defaultValue: number, minValue: number): number {
  const rawValue = getRuntimeEnvVar(name);
  if (!rawValue) {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minValue) {
    throw new Error(`${name} must be an integer greater than or equal to ${minValue}.`);
  }

  return value;
}

export function isDebugLoggingEnabled(): boolean {
  return parseBooleanFlag(getRuntimeEnvVar('NOQ_DEBUG'));
}

export function getProviderTimeoutMs(): number {
  return parseIntegerSetting(
    'NOQ_PROVIDER_TIMEOUT_MS',
    defaultProviderTimeoutMs,
    minProviderTimeoutMs,
  );
}

export function getProviderMaxToolRounds(): number {
  return parseIntegerSetting(
    'NOQ_PROVIDER_MAX_TOOL_ROUNDS',
    defaultProviderMaxToolRounds,
    minProviderMaxToolRounds,
  );
}

export function getRuntimeSettings(): RuntimeSettings {
  return {
    debug: isDebugLoggingEnabled(),
    providerTimeoutMs: getProviderTimeoutMs(),
    providerMaxToolRounds: getProviderMaxToolRounds(),
  };
}

export function setDebugLogFilePath(filePath: string | null): void {
  debugLogFilePath = filePath;
}

export function getDebugLogFilePath(): string | null {
  return debugLogFilePath;
}

function formatDebugLogArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }

  if (arg instanceof Error) {
    return arg.stack ?? arg.message;
  }

  return util.inspect(arg, {
    breakLength: Number.POSITIVE_INFINITY,
    colors: false,
    compact: true,
    depth: 8,
  });
}

function formatDebugLogLine(args: unknown[]): string {
  return `[${new Date().toISOString()}] ${args.map(formatDebugLogArg).join(' ')}`;
}

export function debugLog(...args: unknown[]): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  if (debugLogFilePath) {
    try {
      fs.mkdirSync(path.dirname(debugLogFilePath), { recursive: true });
      fs.appendFileSync(debugLogFilePath, `${formatDebugLogLine(args)}\n`, 'utf-8');
    } catch {
      // Debug logging must never break agent execution or corrupt the TUI.
    }

    return;
  }

  try {
    console.error(...args);
  } catch {
    // Ignore logging failures.
  }
}
