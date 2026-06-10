/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import {
  MacOSScrollAccel,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from '@opentui/core';

import { type ProviderName } from '../../providers/types';
import { type OpenTuiModelsSetupRow } from '../openTuiTypes';
import { openTuiTheme } from '../openTuiTheme';

export const modelsPanelMaxVisibleRows = 11;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getSelectedRowAnchorIndex(visibleSelectableCount: number): number {
  return Math.max(0, Math.floor((visibleSelectableCount - 1) / 2));
}

function formatProviderLabel(provider: ProviderName): string {
  if (provider === 'openai') {
    return 'OpenAI';
  }

  if (provider === 'openrouter') {
    return 'OpenRouter';
  }

  if (provider === 'ollama') {
    return 'Ollama';
  }

  return 'Gemini';
}

function getProviderForRow(rows: OpenTuiModelsSetupRow[], rowIndex: number): ProviderName | null {
  for (let index = rowIndex; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (candidate?.type === 'provider_heading') {
      return candidate.provider;
    }
  }

  return null;
}

function getVisibleRows(rows: OpenTuiModelsSetupRow[], selectedRowKey: string | null): OpenTuiModelsSetupRow[] {
  const selectableRows = rows.filter((row) => row.type !== 'provider_heading');
  const selectedIndex = selectedRowKey
    ? selectableRows.findIndex((row) => row.key === selectedRowKey)
    : -1;
  const safeSelectedIndex = clamp(selectedIndex >= 0 ? selectedIndex : 0, 0, selectableRows.length - 1);
  const visibleSelectableCount = Math.min(modelsPanelMaxVisibleRows, selectableRows.length);
  const selectedRowAnchorIndex = getSelectedRowAnchorIndex(visibleSelectableCount);
  const startIndex = clamp(
    safeSelectedIndex - selectedRowAnchorIndex,
    0,
    Math.max(0, selectableRows.length - visibleSelectableCount),
  );

  const visibleItems = selectableRows.slice(startIndex, startIndex + visibleSelectableCount);
  const firstVisibleItem = visibleItems[0];
  if (!firstVisibleItem) {
    return [];
  }

  const firstVisibleFullRowIndex = rows.findIndex((row) => row.key === firstVisibleItem.key);
  if (firstVisibleFullRowIndex < 0) {
    return visibleItems;
  }

  const stickyProvider = getProviderForRow(rows, firstVisibleFullRowIndex);
  const visibleRows: OpenTuiModelsSetupRow[] = [];
  let selectableCount = 0;

  for (let index = firstVisibleFullRowIndex; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }

    if (row.type === 'provider_heading') {
      if (row.provider !== stickyProvider) {
        visibleRows.push(row);
      }
      continue;
    }

    visibleRows.push(row);
    selectableCount += 1;
    if (selectableCount >= visibleSelectableCount) {
      break;
    }
  }

  return visibleRows;
}

function getStickyProvider(rows: OpenTuiModelsSetupRow[], selectedRowKey: string | null): ProviderName | null {
  const selectableRows = rows.filter((row) => row.type !== 'provider_heading');
  const firstSelectableRow = selectableRows[0];
  if (!firstSelectableRow) {
    return null;
  }

  const selectedIndex = selectedRowKey
    ? selectableRows.findIndex((row) => row.key === selectedRowKey)
    : -1;
  const safeSelectedIndex = clamp(selectedIndex >= 0 ? selectedIndex : 0, 0, selectableRows.length - 1);
  const visibleSelectableCount = Math.min(modelsPanelMaxVisibleRows, selectableRows.length);
  const selectedRowAnchorIndex = getSelectedRowAnchorIndex(visibleSelectableCount);
  const startIndex = clamp(
    safeSelectedIndex - selectedRowAnchorIndex,
    0,
    Math.max(0, selectableRows.length - visibleSelectableCount),
  );
  const firstVisibleSelectable = selectableRows[startIndex];
  if (!firstVisibleSelectable) {
    return null;
  }

  const firstVisibleIndex = rows.findIndex((row) => row.key === firstVisibleSelectable.key);
  return firstVisibleIndex >= 0 ? getProviderForRow(rows, firstVisibleIndex) : null;
}

export function ModelsPanel(props: {
  rows: OpenTuiModelsSetupRow[];
  selectedRowKey: string | null;
  query: string;
  step: 'list' | 'custom';
  activeProvider: ProviderName | null;
  customModelInput: string;
  isLoading: boolean;
  onQueryInput: (value: string) => void;
  onCustomModelInput: (value: string) => void;
  onSubmitSelection: () => void;
  onSubmitCustom: () => void;
  onSelectRow: (rowKey: string) => void;
  scrollRef: (scrollbox: ScrollBoxRenderable) => void;
  searchInputRef: (textarea: TextareaRenderable) => void;
  customInputRef: (textarea: TextareaRenderable) => void;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  let searchTextareaRef: TextareaRenderable | null = null;
  let customTextareaRef: TextareaRenderable | null = null;
  const visibleRows = () => getVisibleRows(props.rows, props.selectedRowKey);
  const stickyProvider = () => getStickyProvider(props.rows, props.selectedRowKey);

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
          Select Model
        </text>
        <box backgroundColor={openTuiTheme.color.teal} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas}>
            {props.step === 'list'
              ? `${props.rows.filter((row) => row.type !== 'provider_heading').length} items`
              : formatProviderLabel(props.activeProvider ?? 'openai')}
          </text>
        </box>
      </box>

      {props.step === 'list' ? (
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
              placeholder="Search models or providers..."
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
      ) : null}

      {props.step === 'list' ? (
        <box
          width="100%"
          paddingX={1}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
        >
          {stickyProvider() ? (
            <box width="100%" paddingX={1} flexShrink={0}>
              <text fg={openTuiTheme.color.amber} truncate flexGrow={1}>
                {formatProviderLabel(stickyProvider()!)}
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
                foregroundColor: openTuiTheme.color.canvas,
              },
            }}
          >
            <box width="100%" flexDirection="column">
              {props.isLoading ? (
                <box paddingX={1}>
                  <text fg={openTuiTheme.color.textSoft}>Loading models...</text>
                </box>
              ) : null}
              <For each={visibleRows()}>
                {(row) => {
                  const isSelected = () => props.selectedRowKey === row.key;
                  return (
                    <box
                      width="100%"
                      paddingX={1}
                      marginTop={row.type === 'provider_heading' ? 1 : 0}
                      backgroundColor={isSelected() ? openTuiTheme.color.teal : openTuiTheme.color.canvas}
                      onMouseDown={() => {
                        if (row.type !== 'provider_heading') {
                          props.onSelectRow(row.key);
                        }
                      }}
                    >
                      {row.type === 'provider_heading' ? (
                        <box width="100%" flexDirection="row" gap={1}>
                          <text fg={openTuiTheme.color.amber} truncate flexGrow={1}>
                            {formatProviderLabel(row.provider)}
                          </text>
                        </box>
                      ) : row.type === 'model' ? (
                        <box width="100%" flexDirection="row" gap={1}>
                          <text
                            fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft}
                            truncate
                            flexGrow={1}
                          >
                            {row.model}
                          </text>
                        </box>
                      ) : (
                        <box width="100%" flexDirection="row" gap={1}>
                          <text
                            fg={isSelected() ? openTuiTheme.color.canvas : openTuiTheme.color.textSoft}
                            truncate
                            flexGrow={1}
                          >
                            custom
                          </text>
                        </box>
                      )}
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
      ) : (
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
      )}

      <box width="100%" flexDirection="row" flexWrap="wrap" flexShrink={0}>
        {props.step === 'list' ? (
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
          <text fg={openTuiTheme.color.textMuted}>{props.step === 'list' ? 'close' : 'back'}</text>
        </box>
      </box>
    </box>
  );
}
