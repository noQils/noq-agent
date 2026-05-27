import { SyntaxStyle } from '@opentui/core';

import { type AgentMode } from '../agentMode';

export type OpenTuiEntryRole = 'user' | 'assistant' | 'system';
export type OpenTuiStatusTone = 'ready' | 'busy' | 'success' | 'warning' | 'danger';

export const openTuiTheme = {
  color: {
    canvas: '#05070d',
    canvasRaised: '#070b14',
    panel: '#09111f',
    panelRaised: '#0d1726',
    panelSoft: '#0a1322',
    rail: '#070d18',
    line: '#1e293b',
    lineSoft: '#162033',
    lineStrong: '#334155',
    text: '#f8fafc',
    textSoft: '#cbd5e1',
    textMuted: '#94a3b8',
    textFaint: '#64748b',
    ghost: '#475569',
    cyan: '#38bdf8',
    cyanStrong: '#67e8f9',
    teal: '#2dd4bf',
    tealSoft: '#14b8a6',
    green: '#34d399',
    greenSoft: '#22c55e',
    amber: '#fbbf24',
    amberSoft: '#f59e0b',
    red: '#fb7185',
    redSoft: '#f87171',
    violet: '#a78bfa',
    chip: '#111827',
    input: '#061322',
    selectionBg: '#164e63',
    selectionFg: '#f8fafc',
    diffAddedBg: '#052e1a',
    diffAddedContentBg: '#064e2a',
    diffRemovedBg: '#3b1018',
    diffRemovedContentBg: '#4c121d',
  },
  role: {
    user: {
      label: 'You',
      accent: '#38bdf8',
      border: '#155e75',
      background: '#071523',
      title: 'Prompt',
    },
    assistant: {
      label: 'Agent',
      accent: '#34d399',
      border: '#166534',
      background: '#07140f',
      title: 'Response',
    },
    system: {
      label: 'System',
      accent: '#fbbf24',
      border: '#854d0e',
      background: '#17110a',
      title: 'Notice',
    },
  },
  status: {
    ready: '#94a3b8',
    busy: '#f59e0b',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#fb7185',
  },
} as const;

let markdownSyntaxStyle: SyntaxStyle | null = null;

export function getOpenTuiMarkdownSyntaxStyle(): SyntaxStyle {
  if (!markdownSyntaxStyle) {
    markdownSyntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: openTuiTheme.color.textSoft },
      text: { fg: openTuiTheme.color.textSoft },
      strong: { fg: openTuiTheme.color.text, bold: true },
      emphasis: { fg: openTuiTheme.color.cyanStrong, italic: true },
      heading: { fg: openTuiTheme.color.text, bold: true },
      link: { fg: openTuiTheme.color.cyanStrong, underline: true },
      code: { fg: openTuiTheme.color.teal, bg: openTuiTheme.color.panelRaised },
      markup: { fg: openTuiTheme.color.textSoft },
      'markup.heading': { fg: openTuiTheme.color.text, bold: true },
      'markup.strong': { fg: openTuiTheme.color.text, bold: true },
      'markup.italic': { fg: openTuiTheme.color.cyanStrong, italic: true },
      'markup.raw': { fg: openTuiTheme.color.teal, bg: openTuiTheme.color.panelRaised },
      'markup.quote': { fg: openTuiTheme.color.textMuted },
      'markup.list': { fg: openTuiTheme.color.teal },
      'markup.link': { fg: openTuiTheme.color.cyanStrong, underline: true },
      'markup.link.label': { fg: openTuiTheme.color.cyanStrong, underline: true },
      'markup.link.url': { fg: openTuiTheme.color.textFaint, underline: true },
      punctuation: { fg: openTuiTheme.color.ghost },
      keyword: { fg: openTuiTheme.color.violet },
      string: { fg: openTuiTheme.color.green },
      number: { fg: openTuiTheme.color.amber },
      comment: { fg: openTuiTheme.color.textFaint, italic: true },
      function: { fg: openTuiTheme.color.cyan },
      variable: { fg: openTuiTheme.color.textSoft },
      operator: { fg: openTuiTheme.color.textMuted },
      inserted: { fg: openTuiTheme.color.green },
      deleted: { fg: openTuiTheme.color.red },
    });
  }

  return markdownSyntaxStyle;
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

export function modeColor(mode: AgentMode): string {
  return mode === 'plan' ? openTuiTheme.color.amber : openTuiTheme.color.green;
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
