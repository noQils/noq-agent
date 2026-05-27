export type SessionEntryKind = 'user' | 'assistant' | 'system';

export interface SessionEntry {
  kind: SessionEntryKind;
  text: string;
}

export interface InteractiveSessionViewModel {
  statusText: string;
  helpText: string;
  entries: SessionEntry[];
  inputLabel: string;
  inputText: string;
  inputTone: 'idle' | 'busy';
  emptyStateText: string;
}
