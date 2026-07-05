import { debugLog, getProviderMaxRetries, getProviderTimeoutMs } from '../../config/runtimeSettings';

const baseBackoffMs = 500;
const maxBackoffMs = 30_000;

const retryableHttpStatuses = new Set([408, 409, 429, 500, 502, 503, 504]);
const retryableErrorCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

// A distinct error type so the retry loop can tell an internal timeout apart
// from an upstream failure without string matching.
class ProviderTimeoutError extends Error {}

function describeProviderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readNumericProperty(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const directStatus = readNumericProperty(record, 'status') ?? readNumericProperty(record, 'statusCode');
  if (directStatus !== undefined) {
    return directStatus;
  }

  const response = record.response;
  if (typeof response === 'object' && response !== null) {
    return readNumericProperty(response as Record<string, unknown>, 'status');
  }

  return undefined;
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const code = record.code ?? record.errno;
  if (typeof code === 'string') {
    return code;
  }

  // undici surfaces network failures as a generic TypeError with the real
  // socket error tucked under `cause`.
  return extractErrorCode(record.cause);
}

function isRetryableError(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status !== undefined) {
    return retryableHttpStatuses.has(status);
  }

  const code = extractErrorCode(error);
  if (code !== undefined) {
    return retryableErrorCodes.has(code);
  }

  return false;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const value = (getter as (key: string) => unknown).call(headers, name);
    return typeof value === 'string' ? value : undefined;
  }

  const value = (headers as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const headers = record.headers
    ?? (typeof record.response === 'object' && record.response !== null
      ? (record.response as Record<string, unknown>).headers
      : undefined);

  const retryAfter = readHeader(headers, 'retry-after');
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function computeBackoffMs(attempt: number, error: unknown): number {
  const retryAfterMs = extractRetryAfterMs(error);
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMs, maxBackoffMs);
  }

  // Exponential backoff with full jitter: random in [0, base * 2^(attempt-1)].
  const ceiling = Math.min(baseBackoffMs * 2 ** (attempt - 1), maxBackoffMs);
  return Math.floor(Math.random() * ceiling);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runSingleAttempt<T>(
  requestFactory: (signal: AbortSignal) => PromiseLike<T> | T,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      // Cancel the in-flight request so a timed-out call does not keep running.
      controller.abort();
      reject(new ProviderTimeoutError(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const requestPromise = Promise.resolve().then(() => requestFactory(controller.signal));
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runProviderRequest<T>(
  providerName: string,
  action: string,
  requestFactory: (signal: AbortSignal) => PromiseLike<T> | T,
  timeoutMs?: number,
): Promise<T> {
  const resolvedTimeoutMs = timeoutMs ?? getProviderTimeoutMs();
  const timeoutMessage = `${providerName} ${action} timed out after ${resolvedTimeoutMs}ms.`;
  const maxAttempts = getProviderMaxRetries() + 1;
  const startedAt = Date.now();

  debugLog('Provider request starting:', {
    providerName,
    action,
    timeoutMs: resolvedTimeoutMs,
    maxAttempts,
  });

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await runSingleAttempt(requestFactory, resolvedTimeoutMs, timeoutMessage);
      debugLog('Provider request completed:', {
        providerName,
        action,
        attempt,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      lastError = error;
      const timedOut = error instanceof ProviderTimeoutError;
      // Timeouts are not retried here: each retry would wait a full timeout
      // window, and the underlying request was already aborted.
      const canRetry = attempt < maxAttempts && !timedOut && isRetryableError(error);

      debugLog('Provider request attempt failed:', {
        providerName,
        action,
        attempt,
        timedOut,
        willRetry: canRetry,
        error: describeProviderError(error),
      });

      if (!canRetry) {
        break;
      }

      const delayMs = computeBackoffMs(attempt, error);
      debugLog('Provider request retrying after backoff:', { providerName, action, attempt, delayMs });
      await sleep(delayMs);
    }
  }

  const message = lastError instanceof ProviderTimeoutError
    ? timeoutMessage
    : `${providerName} ${action} failed: ${describeProviderError(lastError)}`;

  debugLog('Provider request failed:', {
    providerName,
    action,
    durationMs: Date.now() - startedAt,
    error: message,
  });

  throw new Error(message, { cause: lastError });
}
