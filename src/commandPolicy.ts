import { type PermissionOutcome } from './permissions/types';

export type CommandPermissionRules = Record<string, PermissionOutcome>;
export type CommandPermissionConfig = PermissionOutcome | CommandPermissionRules;

const hardBlockedCommandPatterns = [
  /(?:^|[;&|])\s*(?:sudo\s+)?rm\s+-rf\s+(?:\/|\$HOME|~)(?:\s|$)/i,
  /(?:^|[;&|])\s*rmdir\s+\/s\s+\/q\s+(?:[A-Za-z]:\\?$|\\\\)/i,
  /(?:^|[;&|])\s*del\s+\/[pqrs]*\s+(?:[A-Za-z]:\\?$|\\\\)/i,
  /(?:^|[;&|])\s*format(?:\s|$)/i,
  /(?:^|[;&|])\s*(?:shutdown|reboot|poweroff)(?:\s|$)/i,
  /(?:^|[;&|])\s*(?:diskpart|mkfs(?:\.[^\s]+)?)(?:\s|$)/i,
  /\bdd\s+[^|;]*\bof=(?:\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?)|[A-Za-z]:)/i,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function isRuleBasedCommandPermission(
  value: CommandPermissionConfig,
): value is CommandPermissionRules {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHardBlockedCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return hardBlockedCommandPatterns.some((pattern) => pattern.test(normalized));
}

export function matchCommandPattern(command: string, pattern: string): boolean {
  const normalizedCommand = normalizeCommand(command);
  const normalizedPattern = normalizeCommand(pattern);

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern === '*') {
    return true;
  }

  const regex = new RegExp(
    `^${escapeRegExp(normalizedPattern).replaceAll('\\*', '.*')}$`,
  );
  return regex.test(normalizedCommand);
}

export interface CommandPermissionMatch {
  matchedPattern?: string;
  outcome: PermissionOutcome;
}

export function resolveCommandPermission(
  command: string,
  config: CommandPermissionConfig,
): CommandPermissionMatch {
  if (typeof config === 'string') {
    return { outcome: config };
  }

  const normalizedCommand = normalizeCommand(command);
  let matchedPattern: string | undefined;
  let matchedOutcome: PermissionOutcome | undefined;

  for (const [pattern, outcome] of Object.entries(config)) {
    if (!matchCommandPattern(normalizedCommand, pattern)) {
      continue;
    }

    matchedPattern = pattern;
    matchedOutcome = outcome;
  }

  return {
    outcome: matchedOutcome ?? 'ask',
    ...(matchedPattern ? { matchedPattern } : {}),
  };
}
