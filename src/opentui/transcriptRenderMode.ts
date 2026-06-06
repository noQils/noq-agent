import { type OpenTuiEntryRole } from './openTuiTheme';

export type TranscriptRenderMode = 'assistant-markdown' | 'system-diff' | 'plain-text';

export function resolveTranscriptRenderMode(
  kind: OpenTuiEntryRole,
  renderableSystemDiff: string | null,
): TranscriptRenderMode {
  if (kind === 'assistant') {
    return 'assistant-markdown';
  }

  if (kind === 'system' && renderableSystemDiff) {
    return 'system-diff';
  }

  return 'plain-text';
}
