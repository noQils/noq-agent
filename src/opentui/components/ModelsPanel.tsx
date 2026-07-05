/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import {
  MacOSScrollAccel,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from '@opentui/core';

import { type ProviderName } from '../../providers/types';
import { formatProviderLabel } from '../providerLabels';
import { type OpenTuiModelsSetupRow } from '../openTuiTypes';
import { openTuiTheme } from '../openTuiTheme';

export const modelsPanelMaxVisibleRows = 11;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSelectedRowAnchorIndex(visibleCount: number): number {
  return Math.max(0, Math.floor((visibleCount - 1) / 2));
}

function getVisibleModelRows(
  rows: OpenTuiModelsSetupRow[],
  selectedRowKey: string | null,
): OpenTuiModelsSetupRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const selectedIndex = selectedRowKey
    ? rows.findIndex((row) => row.key === selectedRowKey)
    : -1;
  const safeSelectedIndex = clamp(selectedIndex >= 0 ? selectedIndex : 0, 0, rows.length - 1);
  const visibleCount = Math.min(modelsPanelMaxVisibleRows, rows.length);
  const anchorIndex = getSelectedRowAnchorIndex(visibleCount);
  const startIndex = clamp(safeSelectedIndex - anchorIndex, 0, Math.max(0, rows.length - visibleCount));

  return rows.slice(startIndex, startIndex + visibleCount);
}

export function ModelsPanel(props: {
  step: 'provider' | 'list' | 'custom';

  providers: ProviderName[];
  providerSelectedIndex: number;
  providerQuery: string;
  onProviderQueryInput: (value: string) => void;
  onSelectProviderRow: (provider: ProviderName) => void;
  onSubmitProviderSelection: () => void;
  providerScrollRef: (scrollbox: ScrollBoxRenderable) => void;
  providerSearchInputRef: (textarea: TextareaRenderable) => void;

  activeProvider: ProviderName | null;
  rows: OpenTuiModelsSetupRow[];
  selectedRowKey: string | null;
  query: string;
  isLoading: boolean;
  onQueryInput: (value: string) => void;
  onSelectRow: (rowKey: string) => void;
  onSubmitSelection: () => void;
  scrollRef: (scrollbox: ScrollBoxRenderable) => void;
  searchInputRef: (textarea: TextareaRenderable) => void;

  customModelInput: string;
  onCustomModelInput: (value: string) => void;
  onSubmitCustom: () => void;
  customInputRef: (textarea: TextareaRenderable) => void;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  let providerSearchTextareaRef: TextareaRenderable | null = null;
  let searchTextareaRef: TextareaRenderable | null = null;
  let customTextareaRef: TextareaRenderable | null = null;
  const visibleModelRows = () => getVisibleModelRows(props.rows, props.selectedRowKey);

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={openTuiTheme.color.amber}
      focusedBorderColor={openTuiTheme.color.amber}
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
          {props.step === 'provider' ? 'Select Provider' : 'Select Model'}
        </text>
        <box backgroundColor={openTuiTheme.color.teal} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas}>
            {props.step === 'provider'
              ? `${props.providers.length === 0 ? 0 : Math.min(props.providerSelectedIndex + 1, props.providers.length)}/${props.providers.length}`
              : props.step === 'list'
                ? `${props.rows.length} items`
                : formatProviderLabel(props.activeProvider ?? 'openai')}
          </text>
        </box>
      </box>

      {props.step === 'provider' ? (
        <>
          <box width="100%" flexDirection="column" gap={0} flexShrink={0}>
            <box
              width="100%"
              border={['left']}
              borderStyle="heavy"
              borderColor={openTuiTheme.color.amber}
              paddingX={1}
              flexDirection="column"
            >
              <textarea
                ref={(textarea) => {
                  providerSearchTextareaRef = textarea;
                  props.providerSearchInputRef(textarea);
                }}
                initialValue={props.providerQuery}
                placeholder="Search providers..."
                focused
                height={1}
                wrapMode="word"
                textColor={openTuiTheme.color.text}
                focusedTextColor={openTuiTheme.color.text}
                placeholderColor={openTuiTheme.color.textFaint}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
                selectionBg={openTuiTheme.color.selectionBg}
                selectionFg={openTuiTheme.color.selectionFg}
                keyBindings={[
                  { name: 'return', action: 'newline' },
                  { name: 'kpenter', action: 'newline' },
                  { name: 'linefeed', action: 'newline' },
                ]}
                onContentChange={() => {
                  props.onProviderQueryInput((providerSearchTextareaRef?.plainText ?? '').replace(/[\r\n]/g, ''));
                }}
                onSubmit={() => {
                  props.onSubmitProviderSelection();
                }}
              />
            </box>
          </box>

          <box
            width="100%"
            paddingX={1}
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
          >
            <scrollbox
              ref={props.providerScrollRef}
              width="100%"
              flexGrow={1}
              scrollY
              scrollAcceleration={scrollAcceleration}
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
              <box width="100%" flexDirection="column">
                <For each={props.providers}>
                  {(provider, index) => {
                    const isSelected = () => index() === props.providerSelectedIndex;
                    return (
                      <box
                        width="100%"
                        paddingX={1}
                        backgroundColor={isSelected() ? openTuiTheme.color.teal : openTuiTheme.color.canvas}
                        onMouseDown={() => props.onSelectProviderRow(provider)}
                      >
                        <text
                          fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft}
                          truncate
                          flexGrow={1}
                        >
                          {formatProviderLabel(provider)}
                        </text>
                      </box>
                    );
                  }}
                </For>
                {props.providers.length === 0 ? (
                  <box paddingX={1}>
                    <text fg={openTuiTheme.color.textSoft}>No matching providers.</text>
                  </box>
                ) : null}
              </box>
            </scrollbox>
          </box>
        </>
      ) : null}

      {props.step === 'list' ? (
        <>
          <box width="100%" flexDirection="column" gap={0} flexShrink={0}>
            <box
              width="100%"
              border={['left']}
              borderStyle="heavy"
              borderColor={openTuiTheme.color.amber}
              paddingX={1}
              flexDirection="column"
            >
              <textarea
                ref={(textarea) => {
                  searchTextareaRef = textarea;
                  props.searchInputRef(textarea);
                }}
                initialValue={props.query}
                placeholder="Search models..."
                focused
                height={1}
                wrapMode="word"
                textColor={openTuiTheme.color.text}
                focusedTextColor={openTuiTheme.color.text}
                placeholderColor={openTuiTheme.color.textFaint}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
                selectionBg={openTuiTheme.color.selectionBg}
                selectionFg={openTuiTheme.color.selectionFg}
                keyBindings={[
                  { name: 'return', action: 'newline' },
                  { name: 'kpenter', action: 'newline' },
                  { name: 'linefeed', action: 'newline' },
                ]}
                onContentChange={() => {
                  props.onQueryInput((searchTextareaRef?.plainText ?? '').replace(/[\r\n]/g, ''));
                }}
                onSubmit={() => {
                  props.onSubmitSelection();
                }}
              />
            </box>
          </box>

          <box
            width="100%"
            paddingX={1}
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            minHeight={0}
          >
            {props.activeProvider ? (
              <box width="100%" paddingX={1} flexShrink={0}>
                <text fg={openTuiTheme.color.amber} truncate flexGrow={1}>
                  {formatProviderLabel(props.activeProvider)}
                </text>
              </box>
            ) : null}
            <scrollbox
              ref={props.scrollRef}
              width="100%"
              flexGrow={1}
              scrollY
              scrollAcceleration={scrollAcceleration}
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
              <box width="100%" flexDirection="column">
                {props.isLoading ? (
                  <box paddingX={1}>
                    <text fg={openTuiTheme.color.textSoft}>Loading models...</text>
                  </box>
                ) : null}
                <For each={visibleModelRows()}>
                  {(row) => {
                    const isSelected = () => props.selectedRowKey === row.key;
                    return (
                      <box
                        width="100%"
                        paddingX={1}
                        backgroundColor={isSelected() ? openTuiTheme.color.teal : openTuiTheme.color.canvas}
                        onMouseDown={() => props.onSelectRow(row.key)}
                      >
                        <text
                          fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft}
                          truncate
                          flexGrow={1}
                        >
                          {row.type === 'model' ? row.model : 'custom'}
                        </text>
                      </box>
                    );
                  }}
                </For>
                {!props.isLoading && props.rows.length === 0 ? (
                  <box paddingX={1}>
                    <text fg={openTuiTheme.color.textSoft}>No matching models.</text>
                  </box>
                ) : null}
              </box>
            </scrollbox>
          </box>
        </>
      ) : null}

      {props.step === 'custom' ? (
        <box width="100%" paddingX={1} flexDirection="column" flexGrow={1} gap={1}>
          <box>
            <text fg={openTuiTheme.color.textFaint}>Custom Model</text>
          </box>
          <box
            width="100%"
            border={['left']}
            borderStyle="heavy"
            borderColor={openTuiTheme.color.amber}
            paddingX={1}
            flexDirection="column"
          >
            <textarea
              ref={(textarea) => {
                customTextareaRef = textarea;
                props.customInputRef(textarea);
              }}
              initialValue={props.customModelInput}
              placeholder={`Enter model id for ${formatProviderLabel(props.activeProvider ?? 'openai')}...`}
              focused
              height={1}
              wrapMode="word"
              textColor={openTuiTheme.color.text}
              focusedTextColor={openTuiTheme.color.text}
              placeholderColor={openTuiTheme.color.textFaint}
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
              selectionBg={openTuiTheme.color.selectionBg}
              selectionFg={openTuiTheme.color.selectionFg}
              keyBindings={[
                { name: 'return', action: 'newline' },
                { name: 'kpenter', action: 'newline' },
                { name: 'linefeed', action: 'newline' },
              ]}
              onContentChange={() => {
                props.onCustomModelInput((customTextareaRef?.plainText ?? '').replace(/[\r\n]/g, ''));
              }}
              onSubmit={() => {
                props.onSubmitCustom();
              }}
            />
          </box>
          <text fg={openTuiTheme.color.textSoft}>
            Save a model id that is not in the discovered list.
          </text>
        </box>
      ) : null}

      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0}>
        {props.step === 'provider' || props.step === 'list' ? (
          <>
            <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
              <text fg={openTuiTheme.color.teal}>↑/↓</text>
              <text fg={openTuiTheme.color.textMuted}>move</text>
              <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
              <text fg={openTuiTheme.color.teal}>type</text>
              <text fg={openTuiTheme.color.textMuted}>search</text>
              <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
              <text fg={openTuiTheme.color.teal}>enter</text>
              <text fg={openTuiTheme.color.textMuted}>select</text>
              <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
            </box>
          </>
        ) : (
          <>
            <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
              <text fg={openTuiTheme.color.teal}>type</text>
              <text fg={openTuiTheme.color.textMuted}>model id</text>
              <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0} marginRight={1}>
              <text fg={openTuiTheme.color.teal}>enter</text>
              <text fg={openTuiTheme.color.textMuted}>save</text>
              <text fg={openTuiTheme.color.ghost} selectable={false}>•</text>
            </box>
          </>
        )}
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={openTuiTheme.color.teal}>esc</text>
          <text fg={openTuiTheme.color.textMuted}>{props.step === 'provider' ? 'close' : 'back'}</text>
        </box>
      </box>
    </box>
  );
}
