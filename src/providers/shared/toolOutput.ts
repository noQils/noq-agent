import { getMaxToolOutputChars } from '../../config/runtimeSettings';

// Large tool outputs (big file reads, verbose command logs) accumulate verbatim
// in the provider's message history within a single turn and can overflow the
// model's context window on a long, heavy run. Cap the copy fed back to the
// model, keeping the head and the tail so both the start and any trailing
// summary/error survive. The untruncated output is still surfaced elsewhere
// (transcript, mutation notifications) — only the model-facing copy is capped.
export function capToolOutput(output: string, maxChars: number = getMaxToolOutputChars()): string {
  if (output.length <= maxChars) {
    return output;
  }

  const truncatedCount = output.length - maxChars;
  const headChars = Math.ceil(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  const head = output.slice(0, headChars);
  const tail = tailChars > 0 ? output.slice(output.length - tailChars) : '';

  return `${head}\n…[${truncatedCount} characters truncated to fit the model context]…\n${tail}`;
}
