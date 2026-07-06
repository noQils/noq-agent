/** @jsxImportSource @opentui/solid */

import { Index } from 'solid-js';

import { OPEN_TUI_ASCII_LOGO } from '../asciiLogo';
import { openTuiTheme } from '../openTuiTheme';

const GRADIENT_FROM = openTuiTheme.color.teal;
const GRADIENT_TO = openTuiTheme.color.cyanStrong;
const LINE_CHARS = new Set(['═', '║', '╗', '╔', '╝', '╚']);
const LOGO_LINES = OPEN_TUI_ASCII_LOGO.replace(/^\n/, '').replace(/\n$/, '').split('\n');
const LOGO_WIDTH = Math.max(...LOGO_LINES.map((line) => line.length));

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function mixHex(from: string, to: string, t: number): string {
  const [fromR, fromG, fromB] = hexToRgb(from);
  const [toR, toG, toB] = hexToRgb(to);
  const mix = (start: number, end: number) => Math.round(start + (end - start) * t)
    .toString(16)
    .padStart(2, '0');

  return `#${mix(fromR, toR)}${mix(fromG, toG)}${mix(fromB, toB)}`;
}

function displayChar(char: string): string {
  return LINE_CHARS.has(char) ? ' ' : char;
}

function colorForChar(column: number): string {
  return mixHex(GRADIENT_FROM, GRADIENT_TO, column / (LOGO_WIDTH - 1));
}

export function NoqLogo() {
  return (
    <box flexDirection="column">
      <Index each={LOGO_LINES}>
        {(line) => (
          <text selectable={false}>
            <Index each={[...line()]}>
              {(character, column) => (
                <span style={{ fg: colorForChar(column) }}>{displayChar(character())}</span>
              )}
            </Index>
          </text>
        )}
      </Index>
    </box>
  );
}
