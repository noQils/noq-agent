export type NormalizedToolArgsResult =
  | {
      ok: true;
      args: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
    };

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

export function normalizeToolArgs(rawArgs: unknown): NormalizedToolArgsResult {
  if (rawArgs === undefined || rawArgs === null) {
    return {
      ok: true,
      args: {},
    };
  }

  if (typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    return {
      ok: true,
      args: rawArgs as Record<string, unknown>,
    };
  }

  return {
    ok: false,
    error: `Invalid tool arguments: expected an object, received ${describeValue(rawArgs)}.`,
  };
}

export function parseAndNormalizeToolArgsJson(argumentsJson: string): NormalizedToolArgsResult {
  let parsedArgs: unknown;

  try {
    parsedArgs = JSON.parse(argumentsJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Invalid tool arguments: ${message}`,
    };
  }

  return normalizeToolArgs(parsedArgs);
}
