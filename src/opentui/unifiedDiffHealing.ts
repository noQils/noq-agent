import { parsePatch } from 'diff';

// The installed diff@4 runtime validates hunk line counts only when passed
// { strict: true }, but the ambient typings no longer declare the options
// parameter, so widen the signature for the strict call.
const parsePatchWithOptions = parsePatch as unknown as (
  source: string,
  options?: { strict?: boolean },
) => unknown[];

/**
 * Parses a unified diff with hunk line count validation enabled, matching the
 * strictness of the parser bundled in the diff renderable. Throws on invalid
 * diffs.
 */
export function parseUnifiedDiffStrict(text: string): unknown[] {
  return parsePatchWithOptions(text, { strict: true });
}

interface HealableHunk {
  oldStart: string;
  newStart: string;
  trailer: string;
  bodyLines: string[];
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

function isFileHeaderLine(line: string): boolean {
  return line.startsWith('diff --git ')
    || line.startsWith('index ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ');
}

function healHunkBodyLine(line: string): string {
  if (line.length === 0) {
    return ' ';
  }

  const prefix = line[0];
  if (prefix === ' ' || prefix === '+' || prefix === '-' || prefix === '\\') {
    return line;
  }

  return ` ${line}`;
}

function flushHunk(hunk: HealableHunk, healedLines: string[]): void {
  let oldCount = 0;
  let newCount = 0;

  for (const line of hunk.bodyLines) {
    const prefix = line[0];
    if (prefix === ' ') {
      oldCount += 1;
      newCount += 1;
    } else if (prefix === '-') {
      oldCount += 1;
    } else if (prefix === '+') {
      newCount += 1;
    }
  }

  healedLines.push(
    `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${hunk.trailer}`,
    ...hunk.bodyLines,
  );
}

/**
 * Repairs unified diffs that were mangled in storage or transit so strict
 * parsers (like the one bundled in the diff renderable) accept them:
 * - blank hunk lines that lost their leading space become context lines again
 * - hunk lines with an unknown prefix are treated as context lines
 * - each @@ header is rewritten with counts recomputed from the healed body,
 *   which recovers hunks whose trailing blank context line was trimmed away
 */
export function healUnifiedDiffForRender(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const healedLines: string[] = [];
  let currentHunk: HealableHunk | null = null;

  const flushCurrentHunk = (): void => {
    if (currentHunk) {
      flushHunk(currentHunk, healedLines);
      currentHunk = null;
    }
  };

  for (const line of lines) {
    const headerMatch = hunkHeaderPattern.exec(line);
    if (headerMatch) {
      flushCurrentHunk();
      currentHunk = {
        oldStart: headerMatch[1] ?? '0',
        newStart: headerMatch[2] ?? '0',
        trailer: headerMatch[3] ?? '',
        bodyLines: [],
      };
      continue;
    }

    if (isFileHeaderLine(line)) {
      flushCurrentHunk();
      healedLines.push(line);
      continue;
    }

    if (currentHunk) {
      currentHunk.bodyLines.push(healHunkBodyLine(line));
      continue;
    }

    healedLines.push(line);
  }

  flushCurrentHunk();

  return healedLines.join('\n');
}
