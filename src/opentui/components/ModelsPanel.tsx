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

function sourceColor(source: 'live' | 'fallback'): string {
  return source === 'live'
    ? openTuiTheme.color.green
    : openTuiTheme.color.amber;
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

  const selectedRow = () => props.rows.find((row) => row.key === props.selectedRowKey) ?? null;
  const detailProvider = () => props.step === 'custom'
    ? props.activeProvider
    : selectedRow()?.provider ?? null;
  const detailModel = () => {
    if (props.step === 'custom') {
      return props.customModelInput || '(custom)';
    }

    const row = selectedRow();
    if (!row) {
      return '(none)';
    }

    return row.type === 'model' ? row.model : 'custom';
  };
  const detailSource = () => {
    if (props.step === 'custom') {
      const row = props.rows.find((entry) => entry.provider === props.activeProvider && entry.type !== 'provider_heading');
      return row?.source ?? null;
    }

    return selectedRow()?.source ?? null;
  };

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
          <box paddingX={1}>
            <text fg={openTuiTheme.color.textFaint}>Search</text>
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

      <box
        width="100%"
        border={['left']}
        borderStyle="heavy"
        borderColor={openTuiTheme.color.amber}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
      >
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Prov</text>
          </box>
          <text fg={openTuiTheme.color.text} truncate flexGrow={1}>
            {detailProvider() ? formatProviderLabel(detailProvider()!) : '(none)'}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Model</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {detailModel()}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Source</text>
          </box>
          <text
            fg={detailSource() ? sourceColor(detailSource()!) : openTuiTheme.color.textSoft}
            truncate
            flexGrow={1}
          >
            {detailSource() ?? '(none)'}
          </text>
        </box>
      </box>

      {props.step === 'list' ? (
        <box
          width="100%"
          paddingX={1}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
        >
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
              <For each={props.rows}>
                {(row) => {
                  const isSelected = () => props.selectedRowKey === row.key;
                  return (
                    <box
                      width="100%"
                      paddingX={1}
                      backgroundColor={isSelected() ? openTuiTheme.color.tealFade : openTuiTheme.color.canvas}
                      onMouseDown={() => {
                        if (row.type !== 'provider_heading') {
                          props.onSelectRow(row.key);
                        }
                      }}
                    >
                      {row.type === 'provider_heading' ? (
                        <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                          <text fg={openTuiTheme.color.amber} truncate flexGrow={1}>
                            {formatProviderLabel(row.provider)}
                          </text>
                          <text fg={sourceColor(row.source)} flexShrink={0}>
                            {row.source}
                          </text>
                        </box>
                      ) : row.type === 'model' ? (
                        <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                          <text
                            fg={isSelected() ? openTuiTheme.color.text : openTuiTheme.color.textSoft}
                            truncate
                            flexGrow={1}
                          >
                            {row.model}
                          </text>
                          <text fg={sourceColor(row.source)} flexShrink={0}>
                            {row.source}
                          </text>
                        </box>
                      ) : (
                        <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                          <text
                            fg={isSelected() ? openTuiTheme.color.text : openTuiTheme.color.textSoft}
                            truncate
                            flexGrow={1}
                          >
                            custom
                          </text>
                          <text fg={openTuiTheme.color.textFaint} flexShrink={0}>
                            enter id
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
          <text fg={openTuiTheme.color.textMuted}>close</text>
        </box>
      </box>
    </box>
  );
}
