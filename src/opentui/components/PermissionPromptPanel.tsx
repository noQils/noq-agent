/** @jsxImportSource @opentui/solid */

import path from 'node:path';

import { For } from 'solid-js';

import { MacOSScrollAccel, type ScrollBoxRenderable } from '@opentui/core';

import { type PermissionPromptDecision } from '../../permissions/prompt';
import { type PermissionRequest } from '../../permissions/types';
import { getOpenTuiMarkdownSyntaxStyle, openTuiTheme, truncateMiddle } from '../openTuiTheme';

interface PermissionPreview {
  title: string;
  filetype: string;
  kind: 'plain' | 'command' | 'edit' | 'write' | 'patch';
  rawLines: string[];
  lines: string[];
}

type PermissionActionId = PermissionPromptDecision;

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

function truncatePreviewLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) {
    return line;
  }

  return `${line.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatPreviewLines(lines: string[], maxLength: number): string[] {
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

  const rawLines = formatPreviewLines(formatUnknownArgPreview(request.args), maxLength);
  return {
    title: 'request details',
    filetype: 'text',
    kind: 'plain',
    rawLines,
    lines: rawLines,
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

export function PermissionPromptPanel(props: {
  request: PermissionRequest;
  targetMaxLength: number;
  previewMaxLength: number;
  selectedAction: PermissionActionId;
  onAction: (action: PermissionActionId) => void;
  previewScrollRef: (scrollbox: ScrollBoxRenderable) => void;
}) {
  const previewScrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  const targetLabel = () => getPermissionFileLabel(props.request);
  const pathLabel = () => truncateMiddle(getPermissionPathLabel(props.request), props.targetMaxLength);
  const preview = () => formatPermissionPreview(props.request, props.previewMaxLength);
  const targets = () => uniquePermissionTargets(props.request);
  const actionButtonBg = (action: PermissionActionId) => (
    props.selectedAction === action
      ? (action === 'deny' ? openTuiTheme.color.red : openTuiTheme.color.teal)
      : openTuiTheme.color.panelRaised
  );
  const actionButtonFg = (action: PermissionActionId) => (
    props.selectedAction === action ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft
  );
  const detailLabelWidth = 4;

  return (
    <box
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
          scrollAcceleration={previewScrollAcceleration}
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
                    <text fg={openTuiTheme.color.textSoft} wrapMode="none">
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
