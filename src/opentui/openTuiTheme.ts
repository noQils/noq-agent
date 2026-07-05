import { SyntaxStyle } from '@opentui/core';

export type OpenTuiEntryRole = 'user' | 'assistant' | 'system';
export type OpenTuiStatusTone = 'ready' | 'busy' | 'success' | 'warning' | 'danger';
export const canvasColor = '#1a1c24';

export const openTuiTheme = {
  color: {
    canvas: canvasColor,
    panelRaised: '#292c33',
    rail: '#000000',
    line: '#3a3f49',
    lineStrong: '#4b5360',
    text: '#f4f7fb',
    textSoft: '#d7dde7',
    textMuted: '#aab3c2',
    textFaint: '#8994a3',
    ghost: '#646f7d',
    cyan: '#60c5ff',
    cyanStrong: '#9be8ff',
    teal: '#2dd4bf',
    tealFade: '#2dd4be50',
    green: '#7ad17f',
    amber: '#f6c768',
    amberSoft: '#d89b3d',
    red: '#ff7a8a',
    violet: '#c4a3ff',
    input: '#252a32',
    selectionBg: '#295f66',
    selectionFg: '#f4f7fb',
    diffAddedBg: '#1c2a1c',
    diffAddedContentBg: '#1f3220',
    diffRemovedBg: '#2e1c1c',
    diffRemovedContentBg: '#381f1f',
  },
  role: {
    user: {
      label: 'User',
      accent: '#60c5ff',
      border: '#2dd4bf',
      background: canvasColor,
      title: 'Prompt',
    },
    assistant: {
      label: 'Agent',
      accent: '#7ad1c3',
      border: canvasColor,
      background: canvasColor,
      title: 'Response',
    },
    system: {
      label: 'System',
      accent: '#f6c768',
      border: canvasColor,
      background: canvasColor,
      title: 'Notice',
    },
  },
  status: {
    ready: '#aab3c2',
    busy: '#d89b3d',
    success: '#7ad17f',
    warning: '#f6c768',
    danger: '#ff7a8a',
  },
} as const;

let markdownSyntaxStyle: SyntaxStyle | null = null;
let diffSyntaxStyle: SyntaxStyle | null = null;

export function getOpenTuiMarkdownSyntaxStyle(): SyntaxStyle {
  if (!markdownSyntaxStyle) {
    markdownSyntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: openTuiTheme.color.text },
      text: { fg: openTuiTheme.color.text },
      strong: { fg: openTuiTheme.color.text, bold: true },
      emphasis: { fg: openTuiTheme.color.cyanStrong, italic: true },
      heading: { fg: openTuiTheme.color.amber, bold: true },
      link: { fg: openTuiTheme.color.cyanStrong, underline: true },
      code: { fg: openTuiTheme.color.violet },
      markup: { fg: openTuiTheme.color.text },
      'markup.heading': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.1': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.2': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.3': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.4': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.5': { fg: openTuiTheme.color.amber, bold: true },
      'markup.heading.6': { fg: openTuiTheme.color.amber, bold: true },
      'markup.strong': { fg: openTuiTheme.color.text, bold: true },
      'markup.italic': { fg: openTuiTheme.color.cyanStrong, italic: true },
      'markup.raw': { fg: openTuiTheme.color.violet },
      'markup.quote': { fg: openTuiTheme.color.textMuted },
      'markup.list': { fg: openTuiTheme.color.amber },
      'markup.link': { fg: openTuiTheme.color.cyanStrong, underline: true },
      'markup.link.label': { fg: openTuiTheme.color.cyanStrong, underline: true },
      'markup.link.url': { fg: openTuiTheme.color.textFaint, underline: true },
      punctuation: { fg: openTuiTheme.color.ghost },
      keyword: { fg: openTuiTheme.color.violet },
      string: { fg: openTuiTheme.color.green },
      'string.escape': { fg: openTuiTheme.color.green, bold: true },
      number: { fg: openTuiTheme.color.amber },
      comment: { fg: openTuiTheme.color.textFaint, italic: true },
      function: { fg: openTuiTheme.color.cyan },
      variable: { fg: openTuiTheme.color.text },
      'variable.member': { fg: openTuiTheme.color.textSoft },
      operator: { fg: openTuiTheme.color.textMuted },
      type: { fg: openTuiTheme.color.teal },
      constant: { fg: openTuiTheme.color.amberSoft },
      boolean: { fg: openTuiTheme.color.amberSoft, bold: true },
      constructor: { fg: openTuiTheme.color.cyanStrong, bold: true },
      tag: { fg: openTuiTheme.color.teal },
      attribute: { fg: openTuiTheme.color.amber },
      module: { fg: openTuiTheme.color.cyan },
      'markup.list.checked': { fg: openTuiTheme.color.green, bold: true },
      'markup.list.unchecked': { fg: openTuiTheme.color.textMuted },
      'markup.strikethrough': { fg: openTuiTheme.color.textFaint, dim: true },
      inserted: { fg: openTuiTheme.color.green },
      deleted: { fg: openTuiTheme.color.red },
    });
  }

  return markdownSyntaxStyle;
}

export function getOpenTuiDiffSyntaxStyle(): SyntaxStyle {
  if (!diffSyntaxStyle) {
    diffSyntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: openTuiTheme.color.text },
      text: { fg: '#ffd6dc' },
      punctuation: { fg: openTuiTheme.color.cyanStrong },
      keyword: { fg: '#ffd36f'},
      string: { fg: '#8ff7bb' },
      'string.escape': { fg: '#b6ffcf'},
      'string.regexp': { fg: '#ff9fd0' },
      number: { fg: '#ffe082' },
      comment: { fg: openTuiTheme.color.textMuted, italic: true },
      function: { fg: '#cba2f3'},
      variable: { fg: '#fff8f2' },
      'variable.member': { fg: '#d7e6ff' },
      'variable.parameter': { fg: '#fff8f2', italic: true },
      operator: { fg: '#9cc4ff' },
      type: { fg: '#7ee7d9' },
      constant: { fg: '#ffb86b'},
      boolean: { fg: '#ffb86b'},
      constructor: { fg: '#9fe6ff'},
      tag: { fg: '#5ee6c9' },
      attribute: { fg: '#ffcf9c' },
      module: { fg: '#8fd6ff' },
      label: { fg: '#c9d1e0', italic: true },
      inserted: { fg: '#5af29a'},
      deleted: { fg: '#ff8fa1'},
    });
  }

  return diffSyntaxStyle;
}

export function statusLabel(statusMessage: string | null, isBusy: boolean): string {
  if (statusMessage) {
    return statusMessage;
  }

  return isBusy ? 'Working' : 'Ready';
}

export function statusTone(statusMessage: string | null, isBusy: boolean): OpenTuiStatusTone {
  const normalizedStatus = statusMessage?.toLowerCase() ?? '';

  if (normalizedStatus.includes('failed') || normalizedStatus.includes('denied')) {
    return 'danger';
  }

  if (normalizedStatus.includes('approval') || normalizedStatus.includes('awaiting')) {
    return 'warning';
  }

  if (isBusy) {
    return 'busy';
  }

  if (normalizedStatus.includes('completed') || normalizedStatus.includes('resuming')) {
    return 'success';
  }

  return 'ready';
}

export function statusColor(statusMessage: string | null, isBusy: boolean): string {
  return openTuiTheme.status[statusTone(statusMessage, isBusy)];
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const availableLength = maxLength - 3;
  const headLength = Math.ceil(availableLength / 2);
  const tailLength = Math.floor(availableLength / 2);
  return `${value.slice(0, headLength)}...${value.slice(value.length - tailLength)}`;
}

export function compactLocalTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function isUnifiedDiff(text: string): boolean {
  return /^diff --git /m.test(text)
    || (/^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text));
}

export function cappedEntries<T>(entries: T[], maxEntries: number): T[] {
  if (entries.length <= maxEntries) {
    return entries;
  }

  return entries.slice(-maxEntries);
}
