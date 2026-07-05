/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import { type ScrollAcceleration, type ScrollBoxRenderable } from '@opentui/core';

import { type AgentActivityEvent } from '../../providers/types';
import { cappedEntries, openTuiTheme } from '../openTuiTheme';
import { type OpenTuiSessionEntry } from '../openTuiTypes';
import { AgentActivityIndicator } from './AgentActivityIndicator';
import { EmptyTranscriptState } from './EmptyTranscriptState';
import { TranscriptEntry } from './TranscriptEntry';

const maxRenderedEntries = 200;

export function TranscriptPanel(props: {
  entries: OpenTuiSessionEntry[];
  isCompact: boolean;
  isShort: boolean;
  showEntryTime: boolean;
  showSidebar: boolean;
  isBusy: boolean;
  agentActivity: AgentActivityEvent | null;
  scrollAcceleration: ScrollAcceleration;
  scrollRef: (scrollbox: ScrollBoxRenderable) => void;
}) {
  const visibleEntries = () => cappedEntries(props.entries, maxRenderedEntries);
  const hiddenEntryCount = () => Math.max(0, props.entries.length - visibleEntries().length);

  return (
    <box
      backgroundColor={openTuiTheme.color.canvas}
      paddingX={1}
      paddingTop={props.showSidebar ? 0 : 1}
      paddingBottom={1}
      flexDirection="column"
      flexGrow={1}
      minHeight={props.isShort ? 3 : 8}
    >
      <scrollbox
        ref={props.scrollRef}
        flexGrow={1}
        viewportCulling
        scrollAcceleration={props.scrollAcceleration}
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
              {`Showing latest ${visibleEntries().length} of ${props.entries.length} messages`}
            </text>
          </box>
        ) : null}

        <For each={visibleEntries()}>
          {(entry) => (
            <TranscriptEntry entry={entry} showTime={props.showEntryTime} isCompact={props.isCompact} />
          )}
        </For>

        <AgentActivityIndicator
          activity={() => props.agentActivity}
          isBusy={() => props.isBusy}
        />

        {props.entries.length === 0 ? (
          <EmptyTranscriptState isCompact={props.isCompact} />
        ) : null}
      </scrollbox>
    </box>
  );
}
