export type SessionEntryKind = 'user' | 'assistant' | 'system';

export interface SessionEntry {
  kind: SessionEntryKind;
  text: string;
}
