import { debugLog, getProviderTimeoutMs } from '../../runtimeSettings';

function describeProviderError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runProviderRequest<T>(
  providerName: string,
  action: string,
  requestFactory: () => PromiseLike<T> | T,
  timeoutMs?: number,
): Promise<T> {
  const resolvedTimeoutMs = timeoutMs ?? getProviderTimeoutMs();
  const startedAt = Date.now();
  let timeout: NodeJS.Timeout | undefined;
  let timedOut = false;

  debugLog('Provider request starting:', {
    providerName,
    action,
    timeoutMs: resolvedTimeoutMs,
  });

  const requestPromise = Promise.resolve().then(requestFactory);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${providerName} ${action} timed out after ${resolvedTimeoutMs}ms.`));
    }, resolvedTimeoutMs);
  });

  try {
    const result = await Promise.race([requestPromise, timeoutPromise]);
    debugLog('Provider request completed:', {
      providerName,
      action,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const message = timedOut
      ? `${providerName} ${action} timed out after ${resolvedTimeoutMs}ms.`
      : `${providerName} ${action} failed: ${describeProviderError(error)}`;

    debugLog('Provider request failed:', {
      providerName,
      action,
      durationMs: Date.now() - startedAt,
      error: message,
    });

    throw new Error(message, { cause: error });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
