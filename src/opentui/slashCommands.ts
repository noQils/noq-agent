import { isAgentMode } from '../agentMode';

export type SlashCommand =
  | { type: 'none' }
  | { type: 'invalid' }
  | { type: 'connect' }
  | { type: 'models' }
  | { type: 'permissions' }
  | { type: 'exit' }
  | { type: 'diff' }
  | { type: 'undo' }
  | { type: 'plan_show' }
  | { type: 'mode'; mode: 'plan' | 'build' };

export interface SlashCommandCatalogEntry {
  command: string;
  argsHint?: string;
  description: string;
  aliases?: string[];
  parse: (inputLine: string) => SlashCommand | null;
}

export interface SlashCommandSuggestions {
  visible: boolean;
  query: string;
  matches: SlashCommandCatalogEntry[];
}

export const slashCommandCatalog: SlashCommandCatalogEntry[] = [
  {
    command: '/mode',
    argsHint: 'plan|build',
    description: 'Switch agent mode',
    parse: (inputLine) => {
      if (inputLine !== '/mode' && !inputLine.startsWith('/mode ')) {
        return null;
      }

      const requestedMode = inputLine.slice('/mode'.length).trim();
      if (isAgentMode(requestedMode)) {
        return { type: 'mode', mode: requestedMode };
      }

      return { type: 'invalid' };
    },
  },
  {
    command: '/permissions',
    description: 'Open session permissions',
    parse: (inputLine) => inputLine === '/permissions'
      ? { type: 'permissions' }
      : null,
  },
  {
    command: '/connect',
    description: 'Connect provider credentials',
    parse: (inputLine) => inputLine === '/connect'
      ? { type: 'connect' }
      : null,
  },
  {
    command: '/models',
    description: 'Choose the active default model',
    parse: (inputLine) => inputLine === '/models'
      ? { type: 'models' }
      : null,
  },
  {
    command: '/plan',
    argsHint: 'show',
    description: 'Show the latest saved plan',
    parse: (inputLine) => inputLine === '/plan show'
      ? { type: 'plan_show' }
      : null,
  },
  {
    command: '/diff',
    description: 'Open the latest session diff',
    parse: (inputLine) => inputLine === '/diff'
      ? { type: 'diff' }
      : null,
  },
  {
    command: '/undo',
    description: 'Undo the latest session snapshot',
    parse: (inputLine) => inputLine === '/undo'
      ? { type: 'undo' }
      : null,
  },
  {
    command: '/exit',
    description: 'Exit the app',
    aliases: ['/quit'],
    parse: (inputLine) => inputLine === '/exit' || inputLine === '/quit'
      ? { type: 'exit' }
      : null,
  },
];

function getSlashCommandDisplayText(entry: SlashCommandCatalogEntry): string {
  return entry.argsHint ? `${entry.command} ${entry.argsHint}` : entry.command;
}

export function getSlashCommandInsertText(entry: SlashCommandCatalogEntry): string {
  if (!entry.argsHint) {
    return entry.command;
  }

  return entry.argsHint.includes('|')
    ? `${entry.command} `
    : `${entry.command} ${entry.argsHint}`;
}

function isPrefixLikeMatch(candidate: string, query: string): boolean {
  return candidate.startsWith(query) || query.startsWith(`${candidate} `);
}

function getSlashCommandMatchRank(entry: SlashCommandCatalogEntry, normalizedQuery: string): number | null {
  const displayText = getSlashCommandDisplayText(entry).toLowerCase();
  const commandText = entry.command.toLowerCase();
  const aliasTexts = (entry.aliases ?? []).map((alias) => alias.toLowerCase());
  const substringQuery = normalizedQuery.startsWith('/') ? normalizedQuery.slice(1) : normalizedQuery;

  if (normalizedQuery === '/') {
    return 0;
  }

  if (isPrefixLikeMatch(commandText, normalizedQuery) || displayText.startsWith(normalizedQuery)) {
    return 0;
  }

  if (aliasTexts.some((alias) => isPrefixLikeMatch(alias, normalizedQuery))) {
    return 1;
  }

  if (
    displayText.includes(normalizedQuery)
    || (substringQuery.length > 0 && displayText.includes(substringQuery))
  ) {
    return 2;
  }

  return null;
}

export function getSlashCommandCatalogEntries(options?: {
  includeCompactOnly?: boolean;
}): SlashCommandCatalogEntry[] {
  if (options?.includeCompactOnly) {
    return slashCommandCatalog.filter((entry) => entry.command !== '/plan' && entry.command !== '/diff' && entry.command !== '/undo');
  }

  return slashCommandCatalog;
}

export function getSlashCommandSuggestions(input: string): SlashCommandSuggestions {
  const query = input.trimStart().replace(/\r\n/g, '\n').split('\n')[0] ?? '';
  if (!query.startsWith('/')) {
    return {
      visible: false,
      query: '',
      matches: [],
    };
  }

  const normalizedQuery = query.toLowerCase();
  const rankedMatches = slashCommandCatalog
    .map((entry, index) => ({
      entry,
      index,
      rank: getSlashCommandMatchRank(entry, normalizedQuery),
    }))
    .filter((match): match is { entry: SlashCommandCatalogEntry; index: number; rank: number } => match.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index);

  return {
    visible: true,
    query,
    matches: rankedMatches.map((match) => match.entry),
  };
}

export function parseSlashCommand(inputLine: string): SlashCommand {
  for (const entry of slashCommandCatalog) {
    const parsedCommand = entry.parse(inputLine);
    if (parsedCommand) {
      return parsedCommand;
    }
  }

  return inputLine.startsWith('/')
    ? { type: 'invalid' }
    : { type: 'none' };
}
