import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

import { getRuntimeEnvVar } from '../runtimeEnv';

export const defaultProviderTimeoutMs = 180_000;
export const defaultProviderMaxToolRounds = 40;
export const defaultProviderMaxRetries = 3;
export const defaultMaxFlowRounds = 30;
export const defaultMaxToolOutputChars = 16_384;
export const defaultDebugLogMaxBytes = 10 * 1024 * 1024;
export const minProviderTimeoutMs = 1_000;
export const minProviderMaxToolRounds = 1;
export const minProviderMaxRetries = 0;
export const minMaxFlowRounds = 1;
export const minMaxToolOutputChars = 256;
export const minDebugLogMaxBytes = 1024;

export interface RuntimeSettings {
  debug: boolean;
  providerTimeoutMs: number;
  providerMaxToolRounds: number;
  providerMaxRetries: number;
  maxFlowRounds: number;
  maxToolOutputChars: number;
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

export function getProviderMaxRetries(): number {
  return parseIntegerSetting(
    'NOQ_PROVIDER_MAX_RETRIES',
    defaultProviderMaxRetries,
    minProviderMaxRetries,
  );
}

export function getMaxFlowRounds(): number {
  return parseIntegerSetting(
    'NOQ_MAX_FLOW_ROUNDS',
    defaultMaxFlowRounds,
    minMaxFlowRounds,
  );
}

export function getMaxToolOutputChars(): number {
  return parseIntegerSetting(
    'NOQ_MAX_TOOL_OUTPUT_CHARS',
    defaultMaxToolOutputChars,
    minMaxToolOutputChars,
  );
}

export function getDebugLogMaxBytes(): number {
  return parseIntegerSetting(
    'NOQ_DEBUG_LOG_MAX_BYTES',
    defaultDebugLogMaxBytes,
    minDebugLogMaxBytes,
  );
}

export function getRuntimeSettings(): RuntimeSettings {
  return {
    debug: isDebugLoggingEnabled(),
    providerTimeoutMs: getProviderTimeoutMs(),
    providerMaxToolRounds: getProviderMaxToolRounds(),
    providerMaxRetries: getProviderMaxRetries(),
    maxFlowRounds: getMaxFlowRounds(),
    maxToolOutputChars: getMaxToolOutputChars(),
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

// Keep the debug log from growing without bound across a long session: once it
// would exceed the configured size, rotate the current file to a single .1
// backup and start fresh. Best-effort — logging must never break the run.
function rotateDebugLogIfNeeded(filePath: string, incomingBytes: number): void {
  let currentSize: number;
  try {
    currentSize = fs.statSync(filePath).size;
  } catch {
    return;
  }

  if (currentSize + incomingBytes <= getDebugLogMaxBytes()) {
    return;
  }

  try {
    fs.rmSync(`${filePath}.1`, { force: true });
    fs.renameSync(filePath, `${filePath}.1`);
  } catch {
    // If rotation fails, keep appending to the existing file.
  }
}

export function debugLog(...args: unknown[]): void {
  if (!isDebugLoggingEnabled()) {
    return;
  }

  if (debugLogFilePath) {
    try {
      const line = `${formatDebugLogLine(args)}\n`;
      fs.mkdirSync(path.dirname(debugLogFilePath), { recursive: true });
      rotateDebugLogIfNeeded(debugLogFilePath, Buffer.byteLength(line));
      fs.appendFileSync(debugLogFilePath, line, 'utf-8');
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
