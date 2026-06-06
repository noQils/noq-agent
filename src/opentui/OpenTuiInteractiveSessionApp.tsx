/** @jsxImportSource @opentui/solid */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { createEffect, createSignal, For, onCleanup, type Accessor } from 'solid-js';

import { DiffRenderable, type ScrollBoxRenderable, type TextareaRenderable } from '@opentui/core';
import { parsePatch } from 'diff';
import {
  Dynamic,
  extend,
  useKeyboard,
  useRenderer,
  useSelectionHandler,
  useTerminalDimensions,
} from '@opentui/solid';

import { type AgentMode } from '../agentMode';
import { type PermissionPromptDecision } from '../permissions/prompt';
import { type PermissionRequest } from '../permissions/types';
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
  permissionRequest: Accessor<PermissionRequest | null>;
  onInput: (value: string) => void;
  onSubmit: () => void;
  onExit: () => void;
  onPermissionDecision: (decision: PermissionPromptDecision) => void;
}

const maxRenderedEntries = 200;
const diffComponent: any = 'diff';
let copiedSelectionText = '';

interface CommandHint {
  key: string;
  value?: string;
}

function runClipboardWriter(command: string, args: string[], text: string): boolean {
  try {
    const result = spawnSync(command, args, {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });

    return result.error === undefined && result.status === 0;
  } catch {
    return false;
  }
}

function copyToSystemClipboard(text: string): boolean {
  if (process.platform === 'win32') {
    return (
      runClipboardWriter(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
        ],
        text,
      ) || runClipboardWriter('clip.exe', [], text)
    );
  }

  if (process.platform === 'darwin') {
    return runClipboardWriter('pbcopy', [], text);
  }

  return (
    runClipboardWriter('wl-copy', [], text)
    || runClipboardWriter('xclip', ['-selection', 'clipboard'], text)
    || runClipboardWriter('xsel', ['--clipboard', '--input'], text)
  );
}

function sanitizeInputPaste(text: string): string {
  return text.replace(/[\n\r]/g, '');
}

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

function getRenderableUnifiedDiff(text: string): string | null {
  if (!isUnifiedDiff(text)) {
    return null;
  }

  try {
    parsePatch(text);
    return text;
  } catch {
    const healedDiff = healUnifiedDiffForRender(text);
    try {
      parsePatch(healedDiff);
      return healedDiff;
    } catch {
      return null;
    }
  }
}

function commandHints(isCompact: boolean): CommandHint[] {
  if (isCompact) {
    return [
      { key: '/mode' }, 
      { key: '/connect' },
      { key: '/models' },
      { key: '/exit' }, 
      { key: 'Ctrl+O', value: 'newline'},];
  }

  return [
    { key: '/mode', value: 'plan|build' },
    { key: '/connect' },
    { key: '/models' },
    { key: '/plan', value: 'show' },
    { key: '/diff' },
    { key: '/undo' },
    { key: '/exit' },
    { key: 'Ctrl+O', value: 'newline'},
  ];
}

function busySuffix(frame: number): string {
  return '.'.repeat(frame % 4);
}

function AssistantTranscriptContent(props: { text: string }) {
  return (
    <markdown
      content={props.text}
      syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
      fg={openTuiTheme.color.textSoft}
      bg={openTuiTheme.color.canvas}
      conceal
      internalBlockMode="top-level"
      tableOptions={{
        borderColor: openTuiTheme.color.line,
        widthMode: 'full',
        wrapMode: 'word',
      }}
    />
  );
}

function SystemDiffTranscriptContent(props: {
  diffText: string;
  isCompact: boolean;
  backgroundColor: string;
}) {
  return (
    <Dynamic
      component={diffComponent}
      diff={props.diffText}
      view="unified"
      fg={openTuiTheme.color.textSoft}
      syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
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
      fg={props.kind === 'system' ? openTuiTheme.color.textFaint : openTuiTheme.color.text}
      bg={props.backgroundColor}
      wrapMode="word"
      selectionBg={openTuiTheme.color.selectionBg}
      selectionFg={openTuiTheme.color.selectionFg}
    >
      {props.text}
    </text>
  );
}

function TranscriptEntry(props: {
  entry: OpenTuiSessionEntry;
  showTime: boolean;
  isCompact: boolean;
}) {
  const role = () => openTuiTheme.role[props.entry.kind];
  const timestamp = () => compactLocalTime(props.entry.createdAt);
  const systemRenderableDiff = () => (
    props.entry.kind === 'system' ? getRenderableUnifiedDiff(props.entry.text) : null
  );

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
      {props.entry.kind === 'assistant' ? (
        <AssistantTranscriptContent text={props.entry.text} />
      ) : systemRenderableDiff() ? (
        <SystemDiffTranscriptContent
          diffText={systemRenderableDiff()!}
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

function EmptyTranscriptState(props: { isCompact: boolean }) {
  return (
    <box
      flexGrow={1}
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      gap={1}
      justifyContent="center"
      alignItems="center"
    >
      <box flexDirection="row" gap={1}>
        <text fg={openTuiTheme.color.teal} selectable={false}>
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
        <text
          fg={openTuiTheme.color.textMuted}
          selectable={true}
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
        >
          Type a message to begin.
        </text>
      ) : (
        <>
          <text
            fg={openTuiTheme.color.text}
            selectable={true}
            selectionBg={openTuiTheme.color.selectionBg}
            selectionFg={openTuiTheme.color.selectionFg}
          >
            What shall we build today?
          </text>
          <text
            fg={openTuiTheme.color.textMuted}
            wrapMode="word"
            selectable={true}
            selectionBg={openTuiTheme.color.selectionBg}
            selectionFg={openTuiTheme.color.selectionFg}
          >
            Send a prompt below, or use /connect, /models, /diff, /plan show, /undo, and /exit.
          </text>
        </>
      )}
    </box>
  );
}

interface PermissionPreview {
  title: string;
  filetype: string;
  kind: 'plain' | 'command' | 'edit' | 'write' | 'patch';
  rawLines: string[];
  lines: string[];
}

function addPreviewLineNumbers(lines: string[]): string[] {
  const gutterWidth = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(gutterWidth, ' ')} | ${line}`);
}

function permissionPreviewLineBg(preview: PermissionPreview, rawLine: string): string {
  if (preview.kind === 'write') {
    return openTuiTheme.color.diffAddedContentBg;
  }

  if (preview.kind === 'edit' || preview.kind === 'patch') {
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      return openTuiTheme.color.diffAddedContentBg;
    }

    if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      return openTuiTheme.color.diffRemovedContentBg;
    }
  }

  return openTuiTheme.color.panelRaised;
}

type PermissionActionId = PermissionPromptDecision;

const permissionActions: PermissionActionId[] = ['allow_once', 'allow_session', 'deny'];

function permissionScopeColor(scope: PermissionRequest['scope']): string {
  if (scope === 'edit' || scope === 'external_directory') {
    return openTuiTheme.color.amber;
  }

  if (scope === 'bash') {
    return openTuiTheme.color.amberSoft;
  }

  if (scope === 'read' || scope === 'list' || scope === 'grep' || scope === 'glob') {
    return openTuiTheme.color.cyan;
  }

  return openTuiTheme.color.teal;
}

function formatPermissionToolLabel(request: PermissionRequest): string {
  if (request.toolName === 'apply_patch' || request.toolName === 'edit_file') {
    return 'edit';
  }

  if (request.toolName === 'write_file') {
    return 'write';
  }

  return request.toolName.replace(/_/g, ' ');
}

function getStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' ? value : null;
}

function splitPreviewLines(value: string): string[] {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
}

function estimateWrappedLineCount(value: string, availableWidth: number): number {
  const normalizedWidth = Math.max(1, availableWidth);
  const lines = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

  return lines.reduce((count, line) => {
    const lineLength = Math.max(1, line.length);
    return count + Math.max(1, Math.ceil(lineLength / normalizedWidth));
  }, 0);
}

function truncatePreviewLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) {
    return line;
  }

  return `${line.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatPreviewLines(
  lines: string[],
  maxLength: number,
): string[] {
  const visibleLines = lines.map((line) => (
    truncatePreviewLine(line.length === 0 ? ' ' : line, maxLength)
  ));

  return visibleLines.length > 0 ? visibleLines : ['No additional details supplied'];
}

function stringifyPermissionArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatUnknownArgPreview(args: Record<string, unknown>): string[] {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return ['No additional details supplied'];
  }

  return entries.map(([key, value]) => `${key}: ${stringifyPermissionArg(value)}`);
}

function inferPreviewFiletype(target: string): string {
  const extension = target.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  const extensionMap: Record<string, string> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    ps1: 'powershell',
    py: 'python',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'typescript',
    yaml: 'yaml',
    yml: 'yaml',
  };

  return extensionMap[extension] ?? 'text';
}

function buildEditPreviewLines(args: Record<string, unknown>): string[] {
  const oldText = getStringArg(args, 'oldText') ?? '';
  const newText = getStringArg(args, 'newText') ?? '';

  if (!oldText && !newText) {
    return ['No edit snippet supplied'];
  }

  return [
    '--- current',
    '+++ proposed',
    '@@ requested edit @@',
    ...splitPreviewLines(oldText).map((line) => `- ${line}`),
    ...splitPreviewLines(newText).map((line) => `+ ${line}`),
  ];
}

function buildCommandPreviewLines(args: Record<string, unknown>): string[] {
  const command = getStringArg(args, 'command') ?? '';
  const cwd = getStringArg(args, 'cwd');

  return [
    ...(cwd ? [`cwd: ${cwd}`] : []),
    command ? command : 'No command supplied',
  ];
}

function formatPermissionPreview(
  request: PermissionRequest,
  maxLength: number,
): PermissionPreview {
  if (request.toolName === 'edit_file') {
    const rawLines = formatPreviewLines(buildEditPreviewLines(request.args), maxLength);
    return {
      title: 'requested edit',
      filetype: 'diff',
      kind: 'edit',
      rawLines,
      lines: addPreviewLineNumbers(rawLines),
    };
  }

  if (request.toolName === 'write_file') {
    const content = getStringArg(request.args, 'content') ?? '';
    const rawLines = formatPreviewLines(content ? splitPreviewLines(content) : ['[empty file]'], maxLength);
    return {
      title: 'new file content',
      filetype: inferPreviewFiletype(request.target),
      kind: 'write',
      rawLines,
      lines: addPreviewLineNumbers(rawLines.map((line) => `+ ${line}`)),
    };
  }

  if (request.toolName === 'apply_patch') {
    const patch = getStringArg(request.args, 'patch') ?? '';
    const rawLines = formatPreviewLines(patch ? splitPreviewLines(patch) : ['No patch supplied'], maxLength);
    return {
      title: 'patch preview',
      filetype: 'diff',
      kind: 'patch',
      rawLines,
      lines: addPreviewLineNumbers(rawLines),
    };
  }

  if (request.toolName === 'run_command') {
    const rawLines = formatPreviewLines(buildCommandPreviewLines(request.args), maxLength);
    return {
      title: 'command preview',
      filetype: 'bash',
      kind: 'command',
      rawLines,
      lines: rawLines,
    };
  }

  return {
    title: 'request details',
    filetype: 'text',
    kind: 'plain',
    rawLines: formatPreviewLines(formatUnknownArgPreview(request.args), maxLength),
    lines: formatPreviewLines(formatUnknownArgPreview(request.args), maxLength),
  };
}

function uniquePermissionTargets(request: PermissionRequest): string[] {
  return Array.from(new Set(
    [
      ...(request.target ? [request.target] : []),
      ...(request.pathTargets ?? []),
    ].filter((target) => target.trim().length > 0),
  ));
}

function isFileModificationPermission(request: PermissionRequest): boolean {
  return request.toolName === 'edit_file'
    || request.toolName === 'write_file'
    || request.toolName === 'apply_patch';
}

function getPermissionPathLabel(request: PermissionRequest): string {
  const cwd = getStringArg(request.args, 'cwd');
  const prefixWithHomeMarker = (value: string): string => `~/${value.replaceAll('\\', '/').replace(/^\/+/, '')}`;
  const getOuterDirectoryLabel = (value: string): string => {
    const resolvedPath = path.resolve(process.cwd(), value);
    return `~/${path.basename(resolvedPath).replaceAll('\\', '/')}`;
  };

  if (isFileModificationPermission(request) && request.target.trim().length > 0) {
    return prefixWithHomeMarker(path.dirname(request.target));
  }

  if (request.toolName === 'run_command') {
    return getOuterDirectoryLabel(cwd && cwd.trim().length > 0 ? cwd : process.cwd());
  }

  if (cwd && cwd.trim().length > 0) {
    return prefixWithHomeMarker(cwd);
  }

  if (request.pathTargets && request.pathTargets.length > 0) {
    return prefixWithHomeMarker(request.pathTargets[0] ?? request.target);
  }

  return prefixWithHomeMarker(request.target || '(no path)');
}

function getPermissionFileLabel(request: PermissionRequest): string {
  if (!request.target.trim()) {
    return '(no target)';
  }

  return path.resolve(process.cwd(), request.target).replaceAll('\\', '/');
}

function getPermissionDirectoryLabel(request: PermissionRequest): string {
  const cwd = getStringArg(request.args, 'cwd');
  return path.resolve(process.cwd(), cwd && cwd.trim().length > 0 ? cwd : process.cwd()).replaceAll('\\', '/');
}

function getPermissionWorkspaceLabel(): string {
  return process.cwd().replaceAll('\\', '/');
}

function isExternalDirectoryPermission(request: PermissionRequest): boolean {
  return request.scope === 'external_directory';
}

function PermissionPromptPanel(props: {
  request: PermissionRequest;
  isCompact: boolean;
  targetMaxLength: number;
  previewMaxLength: number;
  selectedAction: PermissionActionId;
  onAction: (action: PermissionActionId) => void;
  previewScrollRef: (scrollbox: ScrollBoxRenderable) => void;
}) {
  const targetLabel = () => getPermissionFileLabel(props.request);
  const pathLabel = () => truncateMiddle(getPermissionPathLabel(props.request), props.targetMaxLength);
  const preview = () => formatPermissionPreview(
    props.request,
    props.previewMaxLength,
  );
  const targets = () => uniquePermissionTargets(props.request);
  const actionButtonBg = (action: PermissionActionId) => (
    props.selectedAction === action
      ? (
        action === 'deny'
          ? openTuiTheme.color.red
          : openTuiTheme.color.teal
      )
      : openTuiTheme.color.panelRaised
  );
  const actionButtonFg = (action: PermissionActionId) => (
    props.selectedAction === action ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft
  );
  const detailLabelWidth = 4;

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={openTuiTheme.color.teal}
      focusedBorderColor={openTuiTheme.color.teal}
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      flexDirection="column"
      gap={1}
      width="100%"
      height="100%"
      >
        <box
          flexDirection="row"
          gap={1}
          width="100%"
        alignItems="center"
        flexShrink={0}
        paddingLeft={1}
        justifyContent="space-between"
        >
        <text fg={openTuiTheme.color.amber} flexShrink={1}>
          {isExternalDirectoryPermission(props.request) ? 'External Directory Access' : 'Permission Required'}
        </text>
        <box backgroundColor={permissionScopeColor(props.request.scope)} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas} truncate>
            {props.request.scope.toUpperCase()}
          </text>
        </box>
      </box>

      <box
        width="100%"
        border={['left']}
        borderStyle="heavy"
        borderColor={permissionScopeColor(props.request.scope)}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
      >
        <box flexDirection="row" gap={1}>
          <box width={detailLabelWidth} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Tool</text>
          </box>
          <text fg={openTuiTheme.color.text} truncate flexGrow={1}>
            {formatPermissionToolLabel(props.request)}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={detailLabelWidth} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>
              {isExternalDirectoryPermission(props.request) ? 'Base' : 'Path'}
            </text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {isExternalDirectoryPermission(props.request)
              ? getPermissionWorkspaceLabel()
              : pathLabel()}
          </text>
        </box>
        {isExternalDirectoryPermission(props.request) ? (
          <box flexDirection="row" gap={1}>
            <box width={detailLabelWidth} flexShrink={0}>
              <text fg={openTuiTheme.color.textFaint}>Out</text>
            </box>
            <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
              {props.request.target.trim().length > 0 ? props.request.target : '(no target)'}
            </text>
          </box>
        ) : null}
        {props.request.toolName === 'run_command' ? (
          <box flexDirection="row" gap={1}>
            <box width={detailLabelWidth} flexShrink={0}>
              <text fg={openTuiTheme.color.textFaint}>Dir</text>
            </box>
            <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
              {getPermissionDirectoryLabel(props.request)}
            </text>
          </box>
        ) : null}
        {isFileModificationPermission(props.request) ? (
          <box flexDirection="row" gap={1}>
            <box width={detailLabelWidth} flexShrink={0}>
              <text fg={openTuiTheme.color.textFaint}>
                {isExternalDirectoryPermission(props.request) ? 'Entry' : 'File'}
              </text>
            </box>
            <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
              {targetLabel()}
            </text>
            </box>
        ) : null}
        {targets().length > 1 ? (
          <box flexDirection="row" gap={1}>
            <box width={detailLabelWidth} flexShrink={0}>
              <text fg={openTuiTheme.color.textFaint}>More</text>
            </box>
            <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
              {`${targets().length} paths, primary ${targetLabel()}`}
            </text>
          </box>
        ) : null}
      </box>

      <box
        width="100%"
        paddingX={1}
        paddingY={0}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        title={preview().title}
        titleAlignment="left"
      >
        <scrollbox
          ref={props.previewScrollRef}
          width="100%"
          flexGrow={1}
          scrollY
          backgroundColor={openTuiTheme.color.canvas}
          contentOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          viewportOptions={{
            backgroundColor: openTuiTheme.color.canvas,
          }}
          scrollbarOptions={{
            trackOptions: {
              backgroundColor: openTuiTheme.color.canvas,
              foregroundColor: openTuiTheme.color.panelRaised,
            },
          }}
        >
          {preview().kind === 'plain' ? (
            <code
              content={preview().lines.join('\n')}
              filetype={preview().filetype}
              syntaxStyle={getOpenTuiMarkdownSyntaxStyle()}
              width="100%"
              fg={openTuiTheme.color.textSoft}
              drawUnstyledText
              wrapMode="none"
              selectionBg={openTuiTheme.color.selectionBg}
              selectionFg={openTuiTheme.color.selectionFg}
            />
          ) : (
            <box width="100%" flexDirection="column">
              <For each={preview().lines}>
                {(line, index) => (
                  <box
                    width="100%"
                    backgroundColor={permissionPreviewLineBg(preview(), preview().rawLines[index()] ?? '')}
                  >
                    <text
                      fg={openTuiTheme.color.textSoft}
                      wrapMode="none"
                    >
                      {line}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )}
        </scrollbox>
      </box>

      <box
        width="100%"
        flexDirection="row"
        gap={1}
        justifyContent="flex-end"
        flexShrink={0}
      >
        <box
          backgroundColor={actionButtonBg('allow_once')}
          paddingX={1}
          onMouseDown={() => props.onAction('allow_once')}
        >
          <text fg={actionButtonFg('allow_once')}>
            {'Allow '}
            <u>O</u>
            {'nce'}
          </text>
        </box>
        <box
          backgroundColor={actionButtonBg('allow_session')}
          paddingX={1}
          onMouseDown={() => props.onAction('allow_session')}
        >
          <text fg={actionButtonFg('allow_session')} truncate>
            {'Allow for '}
            <u>S</u>
            {'ession'}
          </text>
        </box>
        <box
          backgroundColor={actionButtonBg('deny')}
          paddingX={1}
          onMouseDown={() => props.onAction('deny')}
        >
          <text fg={actionButtonFg('deny')}>
            <u>D</u>
            {'eny'}
          </text>
        </box>
      </box>

      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0}>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.cyan}>←/→</text>
          <text fg={openTuiTheme.color.textMuted}>choose</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.cyan}>enter</text>
          <text fg={openTuiTheme.color.textMuted}>confirm</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
          <text fg={openTuiTheme.color.cyan}>esc</text>
          <text fg={openTuiTheme.color.textMuted}>deny</text>
          <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={openTuiTheme.color.cyan}>shift+↑/↓</text>
          <text fg={openTuiTheme.color.textMuted}>scroll preview</text>
        </box>
      </box>
    </box>
  );
}

function CommandRail(props: { isCompact: boolean }) {
  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingY={0}
      minHeight={1}
      flexDirection="row"
      gap={1}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <For each={commandHints(props.isCompact)}>
          {(hint, index) => (
            <box flexDirection="row" gap={1}>
              <text fg={openTuiTheme.color.teal} truncate>
                {hint.key}
              </text>
              {hint.value ? (
                <text fg={openTuiTheme.color.textFaint} truncate>
                  {hint.value}
                </text>
              ) : null}
              {index() < commandHints(props.isCompact).length - 1 ? (
                <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
              ) : null}
            </box>
          )}
        </For>
      </box>
    </box>
  );
}

export function OpenTuiInteractiveSessionApp(props: OpenTuiInteractiveSessionAppProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [busyFrame, setBusyFrame] = createSignal(0);
  const [selectedPermissionAction, setSelectedPermissionAction] = createSignal<PermissionActionId>('allow_once');
  let cachedSelectionText = '';
  let permissionPreviewScrollBox: ScrollBoxRenderable | null = null;
  let composerTextarea: TextareaRenderable | null = null;

  useSelectionHandler((selection) => {
    const selectedText = selection.getSelectedText();
    if (selectedText.length > 0) {
      cachedSelectionText = selectedText;
    }
  });

  const copySelectionToClipboard = (): boolean => {
    const liveSelectionText = renderer.getSelection()?.getSelectedText() ?? '';
    const selectedText = liveSelectionText.length > 0 ? liveSelectionText : cachedSelectionText;
    if (selectedText.length === 0) {
      return false;
    }

    copiedSelectionText = selectedText;
    copyToSystemClipboard(selectedText);
    if (renderer.isOsc52Supported()) {
      renderer.copyToClipboardOSC52(selectedText);
    }

    renderer.clearSelection();
    cachedSelectionText = '';
    renderer.requestRender();

    return true;
  };

  const pasteCopiedSelectionIntoInput = (): boolean => {
    if (props.isBusy() || props.permissionRequest() || copiedSelectionText.length === 0) {
      return false;
    }

    const pastedText = sanitizeInputPaste(copiedSelectionText);
    if (pastedText.length === 0) {
      return false;
    }

    props.onInput(`${props.inputValue()}${pastedText}`);
    renderer.requestRender();
    return true;
  };

  const stopPermissionKeyEvent = (key: { preventDefault: () => void; stopPropagation: () => void }): void => {
    key.preventDefault();
    key.stopPropagation();
  };

  const choosePermissionAction = (action: PermissionActionId): void => {
    props.onPermissionDecision(action);
  };

  const moveSelectedPermissionAction = (direction: -1 | 1): void => {
    const currentIndex = permissionActions.indexOf(selectedPermissionAction());
    const nextIndex = (currentIndex + direction + permissionActions.length) % permissionActions.length;
    setSelectedPermissionAction(permissionActions[nextIndex] ?? 'allow_once');
    renderer.requestRender();
  };

  const scrollPermissionPreview = (direction: -1 | 1): void => {
    permissionPreviewScrollBox?.scrollBy(direction * 3, 'step');
    renderer.requestRender();
  };

  useKeyboard((key) => {
    const keyName = key.name.toLowerCase();

    if (key.ctrl && keyName === 'c') {
      copySelectionToClipboard();
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (key.ctrl && keyName === 'v' && pasteCopiedSelectionIntoInput()) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (props.permissionRequest()) {
      if (keyName === 'left') {
        moveSelectedPermissionAction(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'right') {
        moveSelectedPermissionAction(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (key.shift && keyName === 'up') {
        scrollPermissionPreview(-1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (key.shift && keyName === 'down') {
        scrollPermissionPreview(1);
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'enter' || keyName === 'return') {
        choosePermissionAction(selectedPermissionAction());
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'o') {
        choosePermissionAction('allow_once');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 's') {
        choosePermissionAction('allow_session');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'd') {
        choosePermissionAction('deny');
        stopPermissionKeyEvent(key);
        return;
      }

      if (keyName === 'escape') {
        choosePermissionAction('deny');
        stopPermissionKeyEvent(key);
        return;
      }

      stopPermissionKeyEvent(key);
      return;
    }

    if (keyName === 'escape') {
      props.onExit();
    }
  });

  createEffect(() => {
    if (props.permissionRequest()) {
      setSelectedPermissionAction('allow_once');
      permissionPreviewScrollBox?.scrollTo(0);
    }
  });

  createEffect(() => {
    const currentValue = props.inputValue();

    if (composerTextarea && composerTextarea.plainText !== currentValue) {
      composerTextarea.setText(currentValue);
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
  const isMediumTall = () => dimensions().height >= 32 && dimensions().height < 48;
  const isVeryTall = () => dimensions().height >= 48;
  const showEntryTime = () => dimensions().width >= 58;
  const visibleEntries = () => cappedEntries(props.entries(), maxRenderedEntries);
  const hiddenEntryCount = () => Math.max(0, props.entries().length - visibleEntries().length);
  const resolvedStatusLabel = () => statusLabel(props.statusMessage(), props.isBusy());
  const resolvedStatusColor = () => statusColor(props.statusMessage(), props.isBusy());
  const hasPermissionRequest = () => props.permissionRequest() !== null;
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
    if (hasPermissionRequest()) {
      return isNarrow() ? 'Choose O / S / D' : 'Choose permission: O / S / D';
    }

    if (props.isBusy()) {
      return isNarrow() ? 'Waiting...' : 'Waiting for the current turn to finish...';
    }

    return isNarrow() ? 'Message + Enter' : 'Type a message and press Enter (Ctrl+O for newline)';
  };
  const sessionLabel = () => truncateMiddle(props.sessionId, isNarrow() ? 18 : 32);
  const composerTextWidth = () => Math.max(12, dimensions().width - 8);
  const composerLineCount = () => estimateWrappedLineCount(props.inputValue(), composerTextWidth());
  const composerMaxVisibleLines = () => (isCompact() ? 4 : 8);
  const composerVisibleLines = () => {
    if (isVeryTall()) {
      return Math.min(composerMaxVisibleLines(), Math.max(3, composerLineCount()))
    }
    if (isMediumTall()) {
      return Math.min(composerMaxVisibleLines(), Math.max(2, composerLineCount()))
    }
    return Math.min(composerMaxVisibleLines(), Math.max(1, composerLineCount()));
  }
  const composerFrameHeight = () => Math.max(3, composerVisibleLines() + 2);
  const permissionPreviewMaxLength = () => {
    const widthRatio = isCompact() ? 0.82 : 0.72;
    const maxLength = isCompact() ? 70 : 96;
    return Math.min(maxLength, Math.max(24, Math.floor(dimensions().width * widthRatio) - 8));
  };
  const permissionModalInsetX = () => {
    if (isCompact()) {
      return 0;
    }

    const width = dimensions().width;
    return Math.min(24, Math.max(8, Math.floor(width * 0.12)));
  };
  const permissionModalInsetY = () => {
    if (isCompact()) {
      return 0;
    }

    const height = dimensions().height;
    return Math.min(8, Math.max(3, Math.floor(height * 0.16)));
  };

  return (
    <box
      width="100%"
      height="100%"
      padding={1}
      flexDirection="column"
      gap={0}
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
          <text fg={openTuiTheme.color.teal} selectable={false} truncate>
            noq
          </text>
          <text fg={openTuiTheme.color.lineStrong} selectable={false} truncate>
            {'///'}
          </text>
          <text fg={openTuiTheme.color.textMuted} truncate maxWidth={isNarrow() ? 18 : 32}>
            {sessionLabel()}
          </text>
          <box
            backgroundColor={
              props.mode() === 'build'
                ? openTuiTheme.color.teal
                : openTuiTheme.color.amber
            }
            paddingX={1}
          >
            <text
              fg={openTuiTheme.color.canvas}
              selectable={false}
              truncate
            >
              {props.mode().toUpperCase()}
            </text>
          </box>
        </box>

        <box flexDirection="row" flexShrink={0}>
          <text fg={resolvedStatusColor()} selectable={false} truncate maxWidth={isNarrow() ? 16 : 34}>
            {animatedStatus()}
          </text>
        </box>
      </box>

      <box
        backgroundColor={openTuiTheme.color.canvas}
        paddingX={1}
        paddingY={1}
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
              backgroundColor: openTuiTheme.color.canvas,
              foregroundColor: openTuiTheme.color.panelRaised,
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

      {props.permissionRequest() ? (
        <box
          position="absolute"
          top={permissionModalInsetY()}
          right={permissionModalInsetX()}
          bottom={permissionModalInsetY()}
          left={permissionModalInsetX()}
          zIndex={1}
        >
          <PermissionPromptPanel
            request={props.permissionRequest()!}
            isCompact={isCompact()}
            targetMaxLength={isNarrow() ? 36 : 76}
            previewMaxLength={permissionPreviewMaxLength()}
            selectedAction={selectedPermissionAction()}
            onAction={choosePermissionAction}
            previewScrollRef={(scrollbox) => {
              permissionPreviewScrollBox = scrollbox;
            }}
          />
        </box>
      ) : null}

      <box
        border
        borderStyle="rounded"
        borderColor={composerBorderColor()}
        focusedBorderColor={composerFocusedBorderColor()}
        paddingLeft={1}
        paddingRight={3}
        paddingY={0}
        minHeight={composerFrameHeight()}
        height={composerFrameHeight()}
        flexDirection="row"
        alignItems="flex-start"
      >
        <box width={2} flexShrink={0} paddingTop={0}>
          <text fg={props.isBusy() ? openTuiTheme.color.amber : openTuiTheme.color.teal} selectable={false}>
            {'>'}
          </text>
        </box>
        <textarea
          ref={(textarea) => {
            composerTextarea = textarea;
            if (composerTextarea) {
              composerTextarea.setText(props.inputValue());
            }
          }}
          initialValue={props.inputValue()}
          placeholder={placeholder()}
          focused={!props.isBusy() && !hasPermissionRequest()}
          flexGrow={1}
          height={composerVisibleLines()}
          wrapMode="word"
          textColor={openTuiTheme.color.text}
          focusedTextColor={openTuiTheme.color.text}
          placeholderColor={openTuiTheme.color.textFaint}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          selectionBg={openTuiTheme.color.selectionBg}
          selectionFg={openTuiTheme.color.selectionFg}
          keyBindings={[
            { name: 'return', action: 'submit' },
            { name: 'kpenter', action: 'submit' },
            { name: 'linefeed', action: 'submit' },
            { name: 'return', shift: true, action: 'newline' },
            { name: 'kpenter', shift: true, action: 'newline' },
            { name: 'o', ctrl: true, action: 'newline' },
          ]}
          onContentChange={() => {
            if (!hasPermissionRequest()) {
              props.onInput(composerTextarea?.plainText ?? '');
            }
          }}
          onSubmit={() => {
            if (!hasPermissionRequest()) {
              props.onSubmit();
            }
          }}
        />
      </box>

      <CommandRail isCompact={isCompact()} />
    </box>
  );
}
