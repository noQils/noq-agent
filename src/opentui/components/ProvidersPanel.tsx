/** @jsxImportSource @opentui/solid */

import { For } from 'solid-js';

import {
  MacOSScrollAccel,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from '@opentui/core';

import { openTuiTheme } from '../openTuiTheme';
import { type ProviderName } from '../../providers/types';

const providerDescriptions: Record<ProviderName, string> = {
  ollama: 'Use a local Ollama runtime. No API key required.',
  gemini: 'Connect a Google Gemini API key.',
  openai: 'Connect an OpenAI API key.',
  openrouter: 'Connect an OpenRouter API key.',
};

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

function connectionStatus(provider: ProviderName, connectedProviders: ProviderName[]): string {
  if (provider === 'ollama') {
    return 'local';
  }

  return connectedProviders.includes(provider) ? 'saved' : 'not saved';
}

function connectionColor(provider: ProviderName, connectedProviders: ProviderName[]): string {
  const status = connectionStatus(provider, connectedProviders);
  if (status === 'saved' || status === 'local') {
    return openTuiTheme.color.green;
  }

  return openTuiTheme.color.textSoft;
}

export function ProvidersPanel(props: {
  providers: ProviderName[];
  connectedProviders: ProviderName[];
  selectedIndex: number;
  query: string;
  step: 'list' | 'credential';
  activeProvider: ProviderName | null;
  apiKeyInput: string;
  onQueryInput: (value: string) => void;
  onApiKeyInput: (value: string) => void;
  onSubmitSelection: () => void;
  onSubmitCredential: () => void;
  onSelectProvider: (provider: ProviderName) => void;
  scrollRef: (scrollbox: ScrollBoxRenderable) => void;
  searchInputRef: (textarea: TextareaRenderable) => void;
  apiKeyInputRef: (textarea: TextareaRenderable) => void;
}) {
  const scrollAcceleration = new MacOSScrollAccel({ maxMultiplier: 3 });
  const selectedProvider = () => props.providers[props.selectedIndex] ?? props.providers[0] ?? null;
  const detailProvider = () => props.step === 'credential'
    ? props.activeProvider
    : selectedProvider();
  let searchTextareaRef: TextareaRenderable | null = null;
  let apiKeyTextareaRef: TextareaRenderable | null = null;

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
          Connect Provider
        </text>
        <box backgroundColor={openTuiTheme.color.teal} paddingX={1} flexShrink={0}>
          <text fg={openTuiTheme.color.canvas}>
            {props.step === 'list'
              ? `${Math.min(props.selectedIndex + 1, Math.max(props.providers.length, 1))}/${props.providers.length}`
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
            <text fg={openTuiTheme.color.textFaint}>Name</text>
          </box>
          <text fg={openTuiTheme.color.text} truncate flexGrow={1}>
            {detailProvider() ? formatProviderLabel(detailProvider()!) : '(none)'}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Desc</text>
          </box>
          <text fg={openTuiTheme.color.textSoft} truncate flexGrow={1}>
            {detailProvider() ? providerDescriptions[detailProvider()!] : 'No matching providers.'}
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <box width={7} flexShrink={0}>
            <text fg={openTuiTheme.color.textFaint}>Status</text>
          </box>
          <text
            fg={detailProvider()
              ? connectionColor(detailProvider()!, props.connectedProviders)
              : openTuiTheme.color.textSoft}
            truncate
            flexGrow={1}
          >
            {detailProvider() ? connectionStatus(detailProvider()!, props.connectedProviders) : '(none)'}
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
              <For each={props.providers}>
                {(provider, index) => {
                  const isSelected = () => index() === props.selectedIndex;
                  return (
                    <box
                      width="100%"
                      paddingX={1}
                      backgroundColor={isSelected() ? openTuiTheme.color.tealFade : openTuiTheme.color.canvas}
                      onMouseDown={() => props.onSelectProvider(provider)}
                    >
                      <box width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
                        <text
                          fg={isSelected() ? openTuiTheme.color.text : openTuiTheme.color.textSoft}
                          truncate
                          flexGrow={1}
                        >
                          {formatProviderLabel(provider)}
                        </text>
                        <text fg={connectionColor(provider, props.connectedProviders)} flexShrink={0}>
                          {connectionStatus(provider, props.connectedProviders)}
                        </text>
                      </box>
                    </box>
                  );
                }}
              </For>
            </box>
          </scrollbox>
        </box>
      ) : (
        <box width="100%" paddingX={1} flexDirection="column" flexGrow={1} gap={1}>
          <box>
            <text fg={openTuiTheme.color.textFaint}>API Key</text>
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
                apiKeyTextareaRef = textarea;
                props.apiKeyInputRef(textarea);
              }}
              initialValue={props.apiKeyInput}
              placeholder={`Enter API key for ${formatProviderLabel(props.activeProvider ?? 'openai')}...`}
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
                props.onApiKeyInput((apiKeyTextareaRef?.plainText ?? '').replace(/[\r\n]/g, ''));
              }}
              onSubmit={() => {
                props.onSubmitCredential();
              }}
            />
          </box>
          <text fg={openTuiTheme.color.textSoft}>
            The key will be saved to your global auth store.
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
              <text fg={openTuiTheme.color.textMuted}>API key</text>
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
