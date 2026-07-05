/** @jsxImportSource @opentui/solid */

import path from 'node:path';

import { BoxRenderable, CodeRenderable, DiffRenderable, MacOSScrollAccel, type RenderNodeContext } from '@opentui/core';
import { Dynamic, extend } from '@opentui/solid';
import type { Token } from 'marked';

import {
  getOpenTuiDiffSyntaxStyle,
  getOpenTuiMarkdownSyntaxStyle,
  isUnifiedDiff,
  openTuiTheme,
} from '../openTuiTheme';
import { type OpenTuiSessionEntry, type OpenTuiSessionEntryKind } from '../openTuiTypes';
import { resolveTranscriptRenderMode } from '../transcriptRenderMode';
import { healUnifiedDiffForRender, parseUnifiedDiffStrict } from '../unifiedDiffHealing';

extend({ diff: DiffRenderable });

const diffComponent: any = 'diff';

interface ParsedUnifiedDiffPatch {
  oldFileName?: string;
  newFileName?: string;
  hunks?: Array<{
    lines: string[];
  }>;
}

interface RenderableUnifiedDiff {
  diffText: string;
  renderedLineCount: number;
  filePath?: string;
  filetype?: string;
  mutationKind?: 'edit' | 'write';
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

function inferUnifiedDiffFilePath(patches: ParsedUnifiedDiffPatch[]): string | undefined {
  const firstPatch = patches[0];
  if (!firstPatch || patches.length > 1) {
    return undefined;
  }

  return normalizeDiffFilePath(firstPatch.newFileName)
    ?? normalizeDiffFilePath(firstPatch.oldFileName)
    ?? undefined;
}

function getCompactDiffFilePath(filePath: string): string {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const fileName = path.posix.basename(normalizedPath);
  const parentDirectory = path.posix.basename(path.posix.dirname(normalizedPath));

  return parentDirectory && parentDirectory !== '.'
    ? `${parentDirectory}/${fileName}`
    : fileName;
}

function inferUnifiedDiffMutationKind(
  patches: ParsedUnifiedDiffPatch[],
): RenderableUnifiedDiff['mutationKind'] {
  const firstPatch = patches[0];
  if (!firstPatch || patches.length > 1) {
    return undefined;
  }

  return normalizeDiffFilePath(firstPatch.oldFileName) ? 'edit' : 'write';
}

function getUnifiedDiffRenderedLineCount(patches: ParsedUnifiedDiffPatch[]): number {
  const firstPatch = patches[0];
  if (!firstPatch) {
    return 1;
  }

  const lineCount = firstPatch.hunks?.reduce((total, hunk) => (
    total + hunk.lines.filter((line) => (
      line.startsWith(' ')
      || line.startsWith('+')
      || line.startsWith('-')
    )).length
  ), 0) ?? 0;

  return Math.max(1, lineCount);
}

function getDiffTranscriptTitle(
  toolName: string | undefined,
  filePath: string | undefined,
  mutationKind: RenderableUnifiedDiff['mutationKind'],
): string | null {
  if (!filePath) {
    return null;
  }

  if (
    toolName === 'edit_file'
    || (toolName === 'apply_patch' && mutationKind === 'edit')
    || (!toolName && mutationKind === 'edit')
  ) {
    return `→ Edit ${getCompactDiffFilePath(filePath)}`;
  }

  if (
    toolName === 'write_file'
    || (toolName === 'apply_patch' && mutationKind === 'write')
    || (!toolName && mutationKind === 'write')
  ) {
    return `→ Write ${getCompactDiffFilePath(filePath)}`;
  }

  return null;
}

function buildRenderableUnifiedDiff(
  diffText: string,
  patches: ParsedUnifiedDiffPatch[],
): RenderableUnifiedDiff {
  const filePath = inferUnifiedDiffFilePath(patches);
  const filetype = inferUnifiedDiffFiletype(patches);
  const mutationKind = inferUnifiedDiffMutationKind(patches);

  return {
    diffText,
    renderedLineCount: getUnifiedDiffRenderedLineCount(patches),
    ...(filePath ? { filePath } : {}),
    ...(filetype ? { filetype } : {}),
    ...(mutationKind ? { mutationKind } : {}),
  };
}

function getRenderableUnifiedDiff(text: string): RenderableUnifiedDiff | null {
  if (!isUnifiedDiff(text)) {
    return null;
  }

  // Parse strictly: the diff renderable re-parses the text with a strict
  // parser, so a leniently accepted diff would still fail to render there.
  try {
    const patches = parseUnifiedDiffStrict(text) as ParsedUnifiedDiffPatch[];
    return buildRenderableUnifiedDiff(text, patches);
  } catch {
    const healedDiff = healUnifiedDiffForRender(text);
    try {
      const patches = parseUnifiedDiffStrict(healedDiff) as ParsedUnifiedDiffPatch[];
      return buildRenderableUnifiedDiff(healedDiff, patches);
    } catch {
      return null;
    }
  }
}

function renderMarkdownNode(token: Token, context: RenderNodeContext) {
  if (token.type !== 'code') {
    return undefined;
  }

  const rendered = context.defaultRender();
  if (!(rendered instanceof CodeRenderable)) {
    return rendered;
  }

  // CodeRenderable only paints bg behind its own text cells, so setting its
  // `bg` alone leaves blank lines and trailing padding showing the canvas
  // color through — wrap it in a filled box so the whole fence is covered.
  rendered.bg = openTuiTheme.color.codeBlockBg;
  const panel = new BoxRenderable(rendered.ctx, {
    id: `${rendered.id}-panel`,
    width: '100%',
    backgroundColor: openTuiTheme.color.codeBlockBg,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    paddingBottom: 1,
  });
  panel.add(rendered);
  return panel;
}

function AssistantTranscriptContent(props: {
  text: string;
  backgroundColor: string;
}) {
  return (
    <markdown
      content={props.text}
      syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
      fg={openTuiTheme.color.text}
      bg={props.backgroundColor}
      conceal
      concealCode
      internalBlockMode="top-level"
      renderNode={renderMarkdownNode}
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
  renderedLineCount: number;
  title?: string;
  filetype?: string;
  isCompact: boolean;
  backgroundColor: string;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });

  return (
    <box flexDirection="column" gap={1}>
      {props.title ? (
        <text fg={openTuiTheme.color.textFaint} bg={props.backgroundColor}>
          {props.title}
        </text>
      ) : null}
      <scrollbox
        scrollX
        scrollY={false}
        scrollAcceleration={scrollAcceleration}
        height={props.renderedLineCount}
        backgroundColor={props.backgroundColor}
        viewportOptions={{
          backgroundColor: props.backgroundColor,
        }}
        contentOptions={{
          backgroundColor: props.backgroundColor,
        }}
        horizontalScrollbarOptions={{
          trackOptions: {
            backgroundColor: props.backgroundColor,
            foregroundColor: openTuiTheme.color.panelRaised,
          },
        }}
      >
        <Dynamic
          component={diffComponent}
          diff={props.diffText}
          filetype={props.filetype}
          view="unified"
          fg={openTuiTheme.color.textSoft}
          syntaxStyle={getOpenTuiDiffSyntaxStyle()}
          wrapMode="none"
          showLineNumbers={!props.isCompact}
          lineNumberFg={openTuiTheme.color.textMuted}
          lineNumberBg={props.backgroundColor}
          addedLineNumberBg={openTuiTheme.color.diffAddedBg}
          removedLineNumberBg={openTuiTheme.color.diffRemovedBg}
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
      </scrollbox>
    </box>
  );
}

function PlainTranscriptContent(props: {
  text: string;
  kind: OpenTuiSessionEntryKind;
  backgroundColor: string;
}) {
  return (
    <box flexDirection="row" gap={1}>
      {props.kind === 'system' ? (
          <text fg={openTuiTheme.color.textFaint}>
            ◈
          </text>
      ) : null}
      <text
        fg={props.kind === 'system' ? openTuiTheme.color.textFaint : openTuiTheme.color.text}
        bg={props.backgroundColor}
        wrapMode="word"
        selectionBg={openTuiTheme.color.selectionBg}
        selectionFg={openTuiTheme.color.selectionFg}
      >
        {props.text}
      </text>
    </box>
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
  const systemDiffTitle = () => getDiffTranscriptTitle(
    props.entry.toolName,
    systemRenderableDiff()?.filePath,
    systemRenderableDiff()?.mutationKind,
  );
  const renderMode = () => resolveTranscriptRenderMode(props.entry.kind, systemRenderableDiff()?.diffText ?? null);

  return (
    <box
      id={props.entry.id}
      flexDirection="column"
      marginBottom={1}
      border={['left']}
      borderStyle="single"
      borderColor={renderMode() === 'system-diff' ? openTuiTheme.color.amber : role().border}
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
          renderedLineCount={systemRenderableDiff()!.renderedLineCount}
          {...(systemDiffTitle()
            ? { title: systemDiffTitle()! }
            : {})}
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
