

export type ToolCallFingerprint = {
    toolName: string;
    argsKey: string;
};

function sortObjectKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeysDeep);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, nestedValue]) => [key, sortObjectKeysDeep(nestedValue)])
        );
    }

    return value;
}

export function canonicalizeArgs(argumentsJson: string): string {
    const parsed = JSON.parse(argumentsJson);
    return JSON.stringify(sortObjectKeysDeep(parsed));
}

const stallSensitiveTools = new Set(['edit_file', 'write_file', 'run_command']);

function toStallSensitiveCallKeys(calls: ToolCallFingerprint[]): string[] {
    return calls
        .filter(call => stallSensitiveTools.has(call.toolName))
        .map(call => `${call.toolName}:${call.argsKey}`)
        .sort();
}

export function areSameStallSensitiveCalls(
    previousCalls: ToolCallFingerprint[],
    currentCalls: ToolCallFingerprint[],
): boolean {
    const previousKeys = toStallSensitiveCallKeys(previousCalls);
    const currentKeys = toStallSensitiveCallKeys(currentCalls);

    if (previousKeys.length === 0 || currentKeys.length === 0) {
        return false;
    }

    if (previousKeys.length !== currentKeys.length) {
        return false;
    }

    return previousKeys.every((key, index) => key === currentKeys[index]);
}