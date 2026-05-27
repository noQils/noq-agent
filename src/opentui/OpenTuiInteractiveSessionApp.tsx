/** @jsxImportSource @opentui/solid */

import { createEffect, createSignal, For, onCleanup, type Accessor } from 'solid-js';

import { DiffRenderable } from '@opentui/core';
import { Dynamic, extend, useKeyboard, useTerminalDimensions } from '@opentui/solid';

import { type AgentMode } from '../agentMode';
import {
  cappedEntries,
  compactLocalTime,
  getOpenTuiMarkdownSyntaxStyle,
  isUnifiedDiff,
  modeColor,
  openTuiTheme,
  statusColor,
  statusLabel,
  truncateMiddle,
  type OpenTuiEntryRole,
} from './openTuiTheme';

extend({ diff: DiffRenderable });

export type OpenTuiSessionEntryKind = OpenTuiEntryRole;

export interface OpenTuiSessionEntry {
  id: string;
  createdAt: string;
  kind: OpenTuiSessionEntryKind;
  text: string;
}

interface OpenTuiInteractiveSessionAppProps {
  sessionId: string;
  mode: Accessor<AgentMode>;
  entries: Accessor<OpenTuiSessionEntry[]>;
  inputValue: Accessor<string>;
  isBusy: Accessor<boolean>;
  statusMessage: Accessor<string | null>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
}

const maxRenderedEntries = 200;
const diffComponent: any = 'diff';

type AssistantContentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; language: string; content: string }
  | { type: 'table'; lines: string[] };

interface CommandHint {
  key: string;
  value?: string;
}

function commandHints(isCompact: boolean): CommandHint[] {
  if (isCompact) {
    return [{ key: '/mode' }, { key: '/diff' }, { key: '/exit' }];
  }

  return [
    { key: '/mode', value: 'plan|build' },
    { key: '/plan', value: 'show' },
    { key: '/diff' },
    { key: '/undo' },
    { key: '/exit' },
  ];
}

function diffBlockHeight(text: string, isCompact: boolean): number {
  const lineCount = text.split(/\r?\n/).length;
  const maxHeight = isCompact ? 6 : 8;
  return Math.max(4, Math.min(maxHeight, lineCount));
}

function busySuffix(frame: number): string {
  return '.'.repeat(frame % 4);
}

function isFenceLine(line: string): boolean {
  return line.trim().startsWith('```');
}

function isListLine(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

function parseListItem(line: string): string {
  return line.replace(/^\s*[-*]\s+/, '').trim();
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

function parseHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim();
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const nextLine = lines[index + 1] ?? '';
  return line.includes('|') && isTableSeparator(nextLine);
}

function parseAssistantContent(text: string): AssistantContentBlock[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const blocks: AssistantContentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (isFenceLine(line)) {
      const language = line.trim().slice(3).trim() || 'text';
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !isFenceLine(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: 'code', language, content: codeLines.join('\n') });
      continue;
    }

    if (isHeadingLine(line)) {
      blocks.push({ type: 'heading', text: parseHeading(line) });
      index += 1;
      continue;
    }

    if (isListLine(line)) {
      const items: string[] = [];
      while (index < lines.length && isListLine(lines[index] ?? '')) {
        items.push(parseListItem(lines[index] ?? ''));
        index += 1;
      }

      blocks.push({ type: 'list', items });
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        tableLines.push((lines[index] ?? '').trim());
        index += 1;
      }

      blocks.push({ type: 'table', lines: tableLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length
      && (lines[index] ?? '').trim().length > 0
      && !isFenceLine(lines[index] ?? '')
      && !isHeadingLine(lines[index] ?? '')
      && !isListLine(lines[index] ?? '')
      && !isTableStart(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? '').trim());
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function codeBlockHeight(content: string, isCompact: boolean): number {
  const lineCount = content.length === 0 ? 1 : content.split(/\r?\n/).length;
  return Math.max(2, Math.min(isCompact ? 6 : 10, lineCount));
}

function AssistantContent(props: { text: string; isCompact: boolean }) {
  const blocks = () => parseAssistantContent(props.text);

  return (
    <box flexDirection="column" gap={props.isCompact ? 0 : 1}>
      <For each={blocks()}>
        {(block) => {
          if (block.type === 'heading') {
            return (
              <text fg={openTuiTheme.color.text} wrapMode="word">
                {block.text}
              </text>
            );
          }

          if (block.type === 'list') {
            return (
              <box flexDirection="column">
                <For each={block.items}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text fg={openTuiTheme.color.teal}>-</text>
                      <text fg={openTuiTheme.color.textSoft} wrapMode="word" flexGrow={1}>
                        {item}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            );
          }

          if (block.type === 'code') {
            return (
              <box
                border
                borderStyle="rounded"
                borderColor={openTuiTheme.color.line}
                backgroundColor={openTuiTheme.color.panelRaised}
                paddingX={1}
                paddingY={0}
                title={block.language}
              >
                <code
                  content={block.content}
                  filetype={block.language}
                  syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
                  height={codeBlockHeight(block.content, props.isCompact)}
                  width="100%"
                  fg={openTuiTheme.color.textSoft}
                  bg={openTuiTheme.color.panelRaised}
                  drawUnstyledText
                  wrapMode="none"
                  selectionBg={openTuiTheme.color.selectionBg}
                  selectionFg={openTuiTheme.color.selectionFg}
                />
              </box>
            );
          }

          if (block.type === 'table') {
            return (
              <box
                border
                borderStyle="rounded"
                borderColor={openTuiTheme.color.line}
                backgroundColor={openTuiTheme.color.panelRaised}
                flexDirection="column"
                paddingX={1}
              >
                <For each={block.lines}>
                  {(tableLine) => (
                    <text fg={openTuiTheme.color.textSoft} truncate>
                      {tableLine}
                    </text>
                  )}
                </For>
              </box>
            );
          }

          return (
            <text fg={openTuiTheme.color.textSoft} wrapMode="word">
              {block.text}
            </text>
          );
        }}
      </For>
    </box>
  );
}

function TranscriptEntry(props: {
  entry: OpenTuiSessionEntry;
  showTime: boolean;
  isCompact: boolean;
}) {
  const role = () => openTuiTheme.role[props.entry.kind];
  const timestamp = () => compactLocalTime(props.entry.createdAt);

  return (
    <box
      id={props.entry.id}
      flexDirection="column"
      marginBottom={props.isCompact ? 0 : 1}
      border={['left']}
      borderStyle="single"
      borderColor={role().border}
      focusedBorderColor={role().accent}
      backgroundColor={role().background}
      paddingX={1}
      paddingY={0}
    >
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={role().accent} truncate>
          {role().label}
        </text>
        {props.showTime ? (
          <text fg={openTuiTheme.color.textFaint} truncate>
            {timestamp()}
          </text>
        ) : null}
      </box>

      {props.entry.kind === 'assistant' ? (
        <AssistantContent text={props.entry.text} isCompact={props.isCompact} />
      ) : props.entry.kind === 'system' && isUnifiedDiff(props.entry.text) ? (
        <Dynamic
          component={diffComponent}
          diff={props.entry.text}
          height={diffBlockHeight(props.entry.text, props.isCompact)}
          view="unified"
          fg={openTuiTheme.color.textSoft}
          syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
          wrapMode="word"
          showLineNumbers={!props.isCompact}
          lineNumberFg={openTuiTheme.color.textFaint}
          lineNumberBg={role().background}
          addedBg={openTuiTheme.color.diffAddedBg}
          removedBg={openTuiTheme.color.diffRemovedBg}
          contextBg={role().background}
          addedContentBg={openTuiTheme.color.diffAddedContentBg}
          removedContentBg={openTuiTheme.color.diffRemovedContentBg}
          contextContentBg={role().background}
          addedSignColor={openTuiTheme.color.green}
          removedSignColor={openTuiTheme.color.red}
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
        />
      ) : (
        <text
          fg={props.entry.kind === 'system' ? openTuiTheme.color.textSoft : openTuiTheme.color.text}
          bg={role().background}
          wrapMode="word"
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
        >
          {props.entry.text}
        </text>
      )}
    </box>
  );
}

function EmptyTranscriptState(props: { isCompact: boolean }) {
  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={props.isCompact ? 0 : 1}
      flexDirection="column"
      gap={props.isCompact ? 0 : 1}
    >
      <box flexDirection="row" gap={1}>
        <text fg={openTuiTheme.color.teal}>
{`
███╗   ██╗ ██████╗  ██████╗
████╗  ██║██╔═══██╗██╔═══██╗
██╔██╗ ██║██║   ██║██║   ██║
██║╚██╗██║██║   ██║██║   ██║
██║ ╚████║╚██████╔╝╚██████╔╝
╚═╝  ╚═══╝ ╚═════╝  ╚══▀█▄╗
                        ╚═╝
`}
        </text>
      </box>
      {props.isCompact ? (
        <text fg={openTuiTheme.color.textMuted}>Type a message to begin.</text>
      ) : (
        <>
          <text fg={openTuiTheme.color.text}>What shall we build today?</text>
          <text fg={openTuiTheme.color.textMuted} wrapMode="word">
            Send a prompt below, or use /diff, /plan show, /undo, and /exit.
          </text>
        </>
      )}
    </box>
  );
}

function CommandRail(props: { isCompact: boolean }) {
  return (
    <box
      backgroundColor={openTuiTheme.color.rail}
      paddingX={1}
      paddingY={0}
      minHeight={1}
      flexDirection="row"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <For each={commandHints(props.isCompact)}>
          {(hint) => (
            <box flexDirection="row" gap={hint.value ? 1 : 0}>
              <text fg={openTuiTheme.color.teal} truncate>
                {hint.key}
              </text>
              {hint.value ? (
                <text fg={openTuiTheme.color.textFaint} truncate>
                  {hint.value}
                </text>
              ) : null}
            </box>
          )}
        </For>
      </box>
    </box>
  );
}

export function OpenTuiInteractiveSessionApp(props: OpenTuiInteractiveSessionAppProps) {
  const dimensions = useTerminalDimensions();
  const [busyFrame, setBusyFrame] = createSignal(0);

  useKeyboard((key) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      props.onExit();
    }
  });

  createEffect(() => {
    if (!props.isBusy()) {
      setBusyFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setBusyFrame((currentFrame) => (currentFrame + 1) % 4);
    }, 240);

    onCleanup(() => {
      clearInterval(interval);
    });
  });

  const isNarrow = () => dimensions().width < 72;
  const isCompact = () => dimensions().width < 72 || dimensions().height < 22;
  const isShort = () => dimensions().height < 22;
  const showEntryTime = () => dimensions().width >= 58;
  const visibleEntries = () => cappedEntries(props.entries(), maxRenderedEntries);
  const hiddenEntryCount = () => Math.max(0, props.entries().length - visibleEntries().length);
  const resolvedStatusLabel = () => statusLabel(props.statusMessage(), props.isBusy());
  const resolvedStatusColor = () => statusColor(props.statusMessage(), props.isBusy());
  const animatedStatus = () => (
    props.isBusy()
      ? `${resolvedStatusLabel()}${busySuffix(busyFrame())}`
      : resolvedStatusLabel()
  );
  const composerBorderColor = () => (
    props.isBusy() ? openTuiTheme.color.amberSoft : openTuiTheme.color.teal
  );
  const composerFocusedBorderColor = () => (
    props.isBusy() ? openTuiTheme.color.amber : openTuiTheme.color.teal
  );
  const placeholder = () => {
    if (props.isBusy()) {
      return isNarrow() ? 'Waiting...' : 'Waiting for the current turn to finish...';
    }

    return isNarrow() ? 'Message + Enter' : 'Type a message and press Enter';
  };
  const sessionLabel = () => truncateMiddle(props.sessionId, isNarrow() ? 18 : 32);

  return (
    <box
      width="100%"
      height="100%"
      padding={isShort() ? 0 : 1}
      flexDirection="column"
      gap={isShort() ? 0 : 1}
      backgroundColor={openTuiTheme.color.canvas}
    >
      <box
        backgroundColor={openTuiTheme.color.canvas}
        paddingX={1}
        paddingY={0}
        minHeight={1}
        justifyContent="space-between"
        flexDirection="row"
        gap={1}
      >
        <box flexDirection="row" gap={1} flexShrink={1}>
          <text fg={openTuiTheme.color.teal} truncate>
            noq
          </text>
          <text fg={openTuiTheme.color.lineStrong} truncate>
            {'///'}
          </text>
          <text fg={openTuiTheme.color.textMuted} truncate maxWidth={isNarrow() ? 18 : 32}>
            {sessionLabel()}
          </text>
          <box
            backgroundColor={
              props.mode() === 'build'
                ? openTuiTheme.color.teal
                : openTuiTheme.color.panelRaised
            }
            paddingX={1}
          >
            <text
              fg={props.mode() === 'build' ? openTuiTheme.color.canvas : modeColor(props.mode())}
              truncate
            >
              {props.mode().toUpperCase()}
            </text>
          </box>
        </box>

        <box flexDirection="row" flexShrink={0}>
          <text fg={resolvedStatusColor()} truncate maxWidth={isNarrow() ? 16 : 34}>
            {animatedStatus()}
          </text>
        </box>
      </box>

      <box
        backgroundColor={openTuiTheme.color.canvas}
        paddingX={1}
        paddingY={isCompact() ? 0 : 1}
        flexDirection="column"
        flexGrow={1}
        minHeight={isShort() ? 3 : 8}
      >
        <scrollbox
          flexGrow={1}
          stickyScroll
          stickyStart="bottom"
          viewportCulling
          backgroundColor={openTuiTheme.color.canvas}
          contentOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          viewportOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          scrollbarOptions={{
            trackOptions: {
              backgroundColor: openTuiTheme.color.panelRaised,
              foregroundColor: openTuiTheme.color.teal,
            },
          }}
        >
          {hiddenEntryCount() > 0 ? (
            <box marginBottom={1}>
              <text fg={openTuiTheme.color.textFaint}>
                {`Showing latest ${visibleEntries().length} of ${props.entries().length} messages`}
              </text>
            </box>
          ) : null}

          <For each={visibleEntries()}>
            {(entry) => (
              <TranscriptEntry entry={entry} showTime={showEntryTime()} isCompact={isCompact()} />
            )}
          </For>

          {props.entries().length === 0 ? (
            <EmptyTranscriptState isCompact={isCompact()} />
          ) : null}
        </scrollbox>
      </box>

      <box
        border
        borderStyle="rounded"
        borderColor={composerBorderColor()}
        focusedBorderColor={composerFocusedBorderColor()}
        paddingX={1}
        paddingY={0}
        backgroundColor={openTuiTheme.color.input}
        minHeight={3}
        flexDirection="row"
        gap={1}
      >
        <text fg={props.isBusy() ? openTuiTheme.color.amber : openTuiTheme.color.teal}>
          {':::'}
        </text>
        <input
          value={props.inputValue()}
          placeholder={placeholder()}
          focused={!props.isBusy()}
          flexGrow={1}
          textColor={openTuiTheme.color.text}
          focusedTextColor={openTuiTheme.color.text}
          placeholderColor={openTuiTheme.color.textFaint}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
          onInput={props.onInput}
          onSubmit={props.onSubmit}
        />
      </box>

      <CommandRail isCompact={isCompact()} />
    </box>
  );
}
