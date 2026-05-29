import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentTurn } from '../src/workflow';
import { type ChatMessage, type ChatOptions, type Provider } from '../src/providers/types';
import { withTempWorkspace } from './helpers/tempWorkspace';

test('runAgentTurn can use an injected provider without configured API keys', async () => {
  await withTempWorkspace(async () => {
    const observed: {
      messages: ChatMessage[] | undefined;
      options: ChatOptions | undefined;
    } = {
      messages: undefined,
      options: undefined,
    };

    const provider: Provider = {
      async chat(messages, options) {
        observed.messages = messages;
        observed.options = options;
        return {
          text: 'offline smoke ok',
          executedToolCalls: [],
          stopReason: 'no_tool_calls',
        };
      },
    };

    const response = await runAgentTurn('answer briefly', 'plan', { provider });

    assert.equal(response, 'offline smoke ok');
    assert.equal(observed.options?.mode, 'plan');
    assert.ok(observed.messages?.some((message) => message.role === 'system'));
    assert.ok(observed.options?.tools?.some((tool) => tool.name === 'read_file'));
    assert.ok(!observed.options?.tools?.some((tool) => tool.name === 'edit_file'));
  });
});
