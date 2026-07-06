/** @jsxImportSource @opentui/solid */

import { createEffect, createMemo, createSignal, onCleanup, Index } from 'solid-js';

import { type AgentActivityEvent } from '../../providers/types';
import { describeAgentActivity } from '../agentActivityLabels';
import { openTuiTheme } from '../openTuiTheme';

const GLINT_BAND_WIDTH = 5;
const GLINT_TICK_MS = 90;
const GLINT_BASE = openTuiTheme.color.glintBase;
const GLINT_HIGHLIGHT = openTuiTheme.color.glintHighlight;

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function mixHex(base: string, highlight: string, t: number): string {
  const [baseR, baseG, baseB] = hexToRgb(base);
  const [highR, highG, highB] = hexToRgb(highlight);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * t)
    .toString(16)
    .padStart(2, '0');

  return `#${mix(baseR, highR)}${mix(baseG, highG)}${mix(baseB, highB)}`;
}

function glintColorAt(index: number, textLength: number, frame: number): string {
  const cycleLength = textLength + GLINT_BAND_WIDTH * 2;
  const center = (frame % cycleLength) - GLINT_BAND_WIDTH;
  const distance = Math.abs(index - center);
  const intensity = Math.max(0, 1 - distance / GLINT_BAND_WIDTH);
  return mixHex(GLINT_BASE, GLINT_HIGHLIGHT, intensity);
}

export function AgentActivityIndicator(props: {
  activity: () => AgentActivityEvent | null;
  isBusy: () => boolean;
}) {
  const [frame, setFrame] = createSignal(0);

  createEffect(() => {
    if (!props.isBusy() || !props.activity()) {
      return;
    }

    const interval = setInterval(() => {
      setFrame((currentFrame) => currentFrame + 1);
    }, GLINT_TICK_MS);

    onCleanup(() => {
      clearInterval(interval);
    });
  });

  // Memoized so the creative word/action/detail are picked once per activity
  // event, not re-randomized every animation frame (frame ticks every 90ms
  // for the glint sweep and must not influence which words get displayed).
  const label = createMemo(() => {
    const activity = props.activity();
    return activity && props.isBusy() ? describeAgentActivity(activity) : null;
  });

  const displayText = () => {
    const current = label();
    if (!current) {
      return '';
    }

    const suffix = current.action
      ? ` — (${current.action})${current.detail ? ` ${current.detail}` : ''}`
      : ` ${'.'.repeat(frame() % 4)}`;

    return `${current.headline}${suffix}`;
  };

  const displayChars = () => [...displayText()];

  return (
    <>
      {label() ? (
        <box flexDirection="row" gap={1} marginBottom={1} paddingX={1}>
          <text>
            <Index each={displayChars()}>
              {(character, index) => (
                <span style={{ fg: glintColorAt(index, displayChars().length, frame()) }}>
                  {character()}
                </span>
              )}
            </Index>
          </text>
        </box>
      ) : null}
    </>
  );
}
