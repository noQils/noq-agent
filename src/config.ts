import fs from 'node:fs';
import path from 'node:path';

import { isAgentMode, type AgentMode } from './agentMode';
import { providerNames, type ProviderName } from './providers/types';
import {
  isRuleBasedCommandPermission,
  type CommandPermissionConfig,
  type CommandPermissionRules,
} from './commandPolicy';
import { type PermissionOutcome, type PermissionScope } from './permissions/types';

export interface PermissionConfig {
  todo: PermissionOutcome;
  read: PermissionOutcome;
  edit: PermissionOutcome;
  list: PermissionOutcome;
  glob: PermissionOutcome;
  grep: PermissionOutcome;
  bash: CommandPermissionConfig;
  external_directory: PermissionOutcome;
  doom_loop: PermissionOutcome;
}

export interface AgentConfig {
  defaultMode: AgentMode;
  defaultProvider?: ProviderName;
  permission: PermissionConfig;
}

type ConfigFile = {
  defaultMode?: unknown;
  defaultProvider?: unknown;
  permission?: Partial<{
    [Scope in Exclude<PermissionScope, 'bash'>]: PermissionOutcome;
  } & {
    bash: CommandPermissionConfig;
  }>;
};

const CONFIG_FILE_NAME = 'noq-agent.json';

const permissionScopes: Set<PermissionScope> = new Set([
  'todo',
  'read',
  'edit',
  'list',
  'glob',
  'grep',
  'bash',
  'external_directory',
  'doom_loop',
]);

const permissionOutcomes: PermissionOutcome[] = ['allow', 'ask', 'deny'];

export const defaultConfig: AgentConfig = {
  defaultMode: 'build',
  permission: {
    todo: 'allow',
    read: 'allow',
    list: 'allow',
    glob: 'allow',
    grep: 'allow',
    edit: 'ask',
    bash: 'ask',
    external_directory: 'deny',
    doom_loop: 'ask',
  },
};

let cachedConfig: AgentConfig | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPermissionScope(value: string): value is PermissionScope {
  return permissionScopes.has(value as PermissionScope);
}

function isPermissionOutcome(value: unknown): value is PermissionOutcome {
  return typeof value === 'string' && permissionOutcomes.includes(value as PermissionOutcome);
}

function isProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && providerNames.includes(value as ProviderName);
}

function isCommandPermissionRules(value: unknown): value is CommandPermissionRules {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.entries(value).every(([pattern, outcome]) => (
    typeof pattern === 'string'
    && pattern.trim().length > 0
    && isPermissionOutcome(outcome)
  ));
}

function isCommandPermissionConfig(value: unknown): value is CommandPermissionConfig {
  return isPermissionOutcome(value) || isCommandPermissionRules(value);
}

function cloneCommandPermissionConfig(value: CommandPermissionConfig): CommandPermissionConfig {
  return isRuleBasedCommandPermission(value) ? { ...value } : value;
}

function cloneDefaultConfig(): AgentConfig {
  return {
    defaultMode: defaultConfig.defaultMode,
    ...(defaultConfig.defaultProvider ? { defaultProvider: defaultConfig.defaultProvider } : {}),
    permission: {
      ...defaultConfig.permission,
      bash: cloneCommandPermissionConfig(defaultConfig.permission.bash),
    },
  };
}

function validateAndMergeConfig(rawConfig: unknown, configPath: string): AgentConfig {
  if (!isPlainObject(rawConfig)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object.`);
  }

  const configFile = rawConfig as ConfigFile;
  const mergedConfig = cloneDefaultConfig();

  if (configFile.defaultMode !== undefined) {
    if (typeof configFile.defaultMode !== 'string' || !isAgentMode(configFile.defaultMode)) {
      throw new Error(`"defaultMode" in ${configPath} must be "plan" or "build".`);
    }

    mergedConfig.defaultMode = configFile.defaultMode;
  }

  if (configFile.defaultProvider !== undefined) {
    if (!isProviderName(configFile.defaultProvider)) {
      throw new Error(
        `"defaultProvider" in ${configPath} must be one of: ${providerNames.join(', ')}.`,
      );
    }

    mergedConfig.defaultProvider = configFile.defaultProvider;
  }

  if (configFile.permission === undefined) {
    return mergedConfig;
  }

  if (!isPlainObject(configFile.permission)) {
    throw new Error(`"permission" in ${configPath} must be an object.`);
  }

  for (const [scope, outcome] of Object.entries(configFile.permission)) {
    if (!isPermissionScope(scope)) {
      throw new Error(`Unknown permission scope "${scope}" in ${configPath}.`);
    }

    if (scope === 'bash') {
      if (!isCommandPermissionConfig(outcome)) {
        throw new Error(
          `Invalid permission configuration for "bash" in ${configPath}. ` +
          `Expected "${permissionOutcomes.join('" | "')}" or an object mapping command patterns to those values.`,
        );
      }

      mergedConfig.permission.bash = cloneCommandPermissionConfig(outcome);
      continue;
    }

    if (!isPermissionOutcome(outcome)) {
      throw new Error(
        `Invalid permission outcome for "${scope}" in ${configPath}. Expected one of: ${permissionOutcomes.join(', ')}.`
      );
    }

    mergedConfig.permission[scope] = outcome;
  }

  return mergedConfig;
}

export function getConfigPath(): string {
  return path.resolve(process.cwd(), CONFIG_FILE_NAME);
}

export function loadConfig(): AgentConfig {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return cloneDefaultConfig();
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${configPath}: ${message}`);
  }

  return validateAndMergeConfig(parsedConfig, configPath);
}

export function getConfig(): AgentConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = undefined;
}
