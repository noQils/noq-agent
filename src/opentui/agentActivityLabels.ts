import { type AgentActivityEvent } from '../providers/types';
import { getToolByName } from '../tools';
import { truncateMiddle } from './openTuiTheme';

export interface AgentActivityLabel {
  headline: string;
  action: string;
  detail: string | null;
}

const THINKING_WORDS = [
  'Brewing',
  'Percolating',
  'Pondering',
  'Mulling it over',
  'Ruminating',
  'Untangling threads',
  'Connecting the dots',
  'Chewing on it',
  'Noodling',
];

const TOOL_WORDS: Record<string, { words: string[]; action: string }> = {
  read_file: { words: ['Skimming', 'Studying', 'Poring over'], action: 'read' },
  edit_file: { words: ['Polishing', 'Refining', 'Touching up'], action: 'edit' },
  write_file: { words: ['Drafting', 'Crafting', 'Laying down'], action: 'write' },
  apply_patch: { words: ['Stitching', 'Patching', 'Weaving in'], action: 'patch' },
  grep: { words: ['Sleuthing', 'Hunting', 'Tracing'], action: 'grep' },
  glob: { words: ['Sifting', 'Combing', 'Rifling'], action: 'glob' },
  list_dir: { words: ['Peeking into', 'Browsing'], action: 'list' },
  run_command: { words: ['Tinkering', 'Cranking', 'Firing up'], action: 'run' },
  web_fetch: { words: ['Browsing', 'Fetching'], action: 'fetch' },
  todo_write: { words: ['Jotting down', 'Organizing'], action: 'todo' },
  todo_read: { words: ['Checking', 'Reviewing'], action: 'todo' },
  git_status: { words: ['Checking in on'], action: 'status' },
  git_diff: { words: ['Comparing', 'Diffing'], action: 'diff' },
  get_diagnostics: { words: ['Double-checking'], action: 'diagnostics' },
  go_to_definition: { words: ['Chasing down'], action: 'lookup' },
  find_references: { words: ['Tracking down'], action: 'lookup' },
  rename_symbol: { words: ['Rebranding'], action: 'rename' },
};

const DEFAULT_TOOL_WORDS = { words: ['Working on', 'Handling'], action: 'tool' };

const DETAIL_MAX_LENGTH = 56;

function pick(words: string[]): string {
  return words[Math.floor(Math.random() * words.length)] ?? words[0] ?? '';
}

export function describeAgentActivity(event: AgentActivityEvent): AgentActivityLabel {
  if (event.type === 'thinking') {
    return { headline: pick(THINKING_WORDS), action: '', detail: null };
  }

  const config = TOOL_WORDS[event.toolName] ?? DEFAULT_TOOL_WORDS;
  const tool = getToolByName(event.toolName);
  const rawDetail = tool?.permission.getTarget(event.args) ?? '';

  return {
    headline: pick(config.words),
    action: config.action || event.toolName,
    detail: rawDetail ? truncateMiddle(rawDetail, DETAIL_MAX_LENGTH) : null,
  };
}
