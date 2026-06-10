/** @jsxImportSource @opentui/solid */

import path from 'node:path';

import { DiffRenderable } from '@opentui/core';
import { parsePatch } from 'diff';
import { Dynamic, extend } from '@opentui/solid';

import {
  getOpenTuiDiffSyntaxStyle,
  getOpenTuiMarkdownSyntaxStyle,
  isUnifiedDiff,
  openTuiTheme,
} from '../openTuiTheme';
import { type OpenTuiSessionEntry, type OpenTuiSessionEntryKind } from '../openTuiTypes';
import { resolveTranscriptRenderMode } from '../transcriptRenderMode';

extend({ diff: DiffRenderable });

const diffComponent: any = 'diff';

interface ParsedUnifiedDiffPatch {
  oldFileName?: string;
  newFileName?: string;
}

interface RenderableUnifiedDiff {
  diffText: string;
  filetype?: string;
}

const diffFiletypeByExtension: Record<string, string> = {
  cjs: 'javascript',
  css: 'css',
  htm: 'html',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  markdown: 'markdown',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
};

function healUnifiedDiffForRender(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const healedLines: string[] = [];
  let insideHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      insideHunk = true;
      healedLines.push(line);
      continue;
    }

    if (
      line.startsWith('diff --git ')
      || line.startsWith('index ')
      || line.startsWith('--- ')
      || line.startsWith('+++ ')
    ) {
      insideHunk = false;
      healedLines.push(line);
      continue;
    }

    if (!insideHunk) {
      healedLines.push(line);
      continue;
    }

    if (line.length === 0) {
      healedLines.push(' ');
      continue;
    }

    const prefix = line[0];
    if (prefix === ' ' || prefix === '+' || prefix === '-' || prefix === '\\') {
      healedLines.push(line);
      continue;
    }

    healedLines.push(` ${line}`);
  }

  return healedLines.join('\n');
}

function normalizeDiffFilePath(filePath: string | undefined): string | null {
  if (!filePath) {
    return null;
  }

  const trimmedPath = filePath.trim();
  if (trimmedPath.length === 0 || trimmedPath === '/dev/null') {
    return null;
  }

  return trimmedPath.replace(/^(?:a|b)\//, '');
}

function getDiffFileExtension(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const basename = path.posix.basename(filePath.replaceAll('\\', '/'));
  const extensionIndex = basename.lastIndexOf('.');
  if (extensionIndex <= 0 || extensionIndex === basename.length - 1) {
    return null;
  }

  return basename.slice(extensionIndex + 1).toLowerCase();
}

function inferPatchFiletype(patch: ParsedUnifiedDiffPatch): string | undefined {
  const normalizedPath = normalizeDiffFilePath(patch.newFileName)
    ?? normalizeDiffFilePath(patch.oldFileName);
  const extension = getDiffFileExtension(normalizedPath);

  if (!extension) {
    return undefined;
  }

  return diffFiletypeByExtension[extension];
}

function inferUnifiedDiffFiletype(patches: ParsedUnifiedDiffPatch[]): string | undefined {
  const firstPatch = patches[0];
  if (!firstPatch || patches.length > 1) {
    return undefined;
  }

  return inferPatchFiletype(firstPatch);
}

function buildRenderableUnifiedDiff(diffText: string, filetype: string | undefined): RenderableUnifiedDiff {
  return filetype ? { diffText, filetype } : { diffText };
}

function getRenderableUnifiedDiff(text: string): RenderableUnifiedDiff | null {
  if (!isUnifiedDiff(text)) {
    return null;
  }

  try {
    const patches = parsePatch(text) as ParsedUnifiedDiffPatch[];
    return buildRenderableUnifiedDiff(text, inferUnifiedDiffFiletype(patches));
  } catch {
    const healedDiff = healUnifiedDiffForRender(text);
    try {
      const patches = parsePatch(healedDiff) as ParsedUnifiedDiffPatch[];
      return buildRenderableUnifiedDiff(healedDiff, inferUnifiedDiffFiletype(patches));
    } catch {
      return null;
    }
  }
}

function AssistantTranscriptContent(props: {
  text: string;
  backgroundColor: string;
}) {
  return (
    <markdown
      content={props.text}
      syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
      fg={openTuiTheme.color.textSoft}
      bg={props.backgroundColor}
      conceal
      concealCode
      internalBlockMode="top-level"
      tableOptions={{
        style: 'grid',
        borders: true,
        outerBorder: true,
        borderStyle: 'rounded',
        borderColor: openTuiTheme.color.line,
        widthMode: 'full',
        wrapMode: 'word',
        cellPaddingX: 1,
      }}
    />
  );
}

function SystemDiffTranscriptContent(props: {
  diffText: string;
  filetype?: string;
  isCompact: boolean;
  backgroundColor: string;
}) {
  return (
    <Dynamic
      component={diffComponent}
      diff={props.diffText}
      filetype={props.filetype}
      view="unified"
      fg={openTuiTheme.color.textSoft}
      syntaxStyle={getOpenTuiDiffSyntaxStyle()}
      wrapMode="word"
      showLineNumbers={!props.isCompact}
      lineNumberFg={openTuiTheme.color.textFaint}
      lineNumberBg={props.backgroundColor}
      addedBg={openTuiTheme.color.diffAddedBg}
      removedBg={openTuiTheme.color.diffRemovedBg}
      contextBg={props.backgroundColor}
      addedContentBg={openTuiTheme.color.diffAddedContentBg}
      removedContentBg={openTuiTheme.color.diffRemovedContentBg}
      contextContentBg={props.backgroundColor}
      addedSignColor={openTuiTheme.color.green}
      removedSignColor={openTuiTheme.color.red}
      selectionBg={openTuiTheme.color.selectionBg}
      selectionFg={openTuiTheme.color.selectionFg}
    />
  );
}

function PlainTranscriptContent(props: {
  text: string;
  kind: OpenTuiSessionEntryKind;
  backgroundColor: string;
}) {
  return (
    <text
      fg={props.kind === 'system' ? openTuiTheme.color.ghost : openTuiTheme.color.text}
      bg={props.backgroundColor}
      wrapMode="word"
      selectionBg={openTuiTheme.color.selectionBg}
      selectionFg={openTuiTheme.color.selectionFg}
    >
      {props.text}
    </text>
  );
}

export function TranscriptEntry(props: {
  entry: OpenTuiSessionEntry;
  showTime: boolean;
  isCompact: boolean;
}) {
  const role = () => openTuiTheme.role[props.entry.kind];
  const systemRenderableDiff = () => (
    props.entry.kind === 'system' ? getRenderableUnifiedDiff(props.entry.text) : null
  );
  const renderMode = () => resolveTranscriptRenderMode(props.entry.kind, systemRenderableDiff()?.diffText ?? null);

  return (
    <box
      id={props.entry.id}
      flexDirection="column"
      marginBottom={1}
      border={['left']}
      borderStyle="heavy"
      borderColor={role().border}
      focusedBorderColor={role().accent}
      backgroundColor={role().background}
      paddingX={1}
      paddingY={0}
    >
      {renderMode() === 'assistant-markdown' ? (
        <AssistantTranscriptContent
          text={props.entry.text}
          backgroundColor={role().background}
        />
      ) : renderMode() === 'system-diff' ? (
        <SystemDiffTranscriptContent
          diffText={systemRenderableDiff()!.diffText}
          {...(systemRenderableDiff()!.filetype
            ? { filetype: systemRenderableDiff()!.filetype }
            : {})}
          isCompact={props.isCompact}
          backgroundColor={role().background}
        />
      ) : (
        <PlainTranscriptContent
          text={props.entry.text}
          kind={props.entry.kind}
          backgroundColor={role().background}
        />
      )}
    </box>
  );
}
