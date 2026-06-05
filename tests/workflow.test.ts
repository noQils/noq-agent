import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentTurn } from '../src/workflow';
import {
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type Provider,
} from '../src/providers/types';
import { withTempWorkspace } from './helpers/tempWorkspace';

function createSequenceProvider(results: ChatResult[]): {
  calls: ChatMessage[][];
  provider: Provider;
} {
  const calls: ChatMessage[][] = [];
  let callIndex = 0;

  return {
    calls,
    provider: {
      async chat(messages) {
        calls.push(messages);
        const result = results[callIndex];
        callIndex++;

        if (!result) {
          throw new Error(`Unexpected provider call ${callIndex}.`);
        }

        return result;
      },
    },
  };
}

function getLastUserMessage(messages: ChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

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

    assert.equal(response.response, 'offline smoke ok');
    assert.equal(observed.options?.mode, 'plan');
    assert.ok(observed.messages?.some((message) => message.role === 'system'));
    assert.ok(observed.options?.tools?.some((tool) => tool.name === 'read_file'));
    assert.ok(!observed.options?.tools?.some((tool) => tool.name === 'edit_file'));
  });
});

test('runAgentTurn sends blocked tool reminders instead of retrying blindly', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'npm test' },
          succeeded: false,
          failureKind: 'permission_denied',
          permissionScope: 'bash',
          target: 'npm test',
          permissionDeniedBy: 'policy',
        }],
      },
      {
        text: 'Cannot run the blocked command without a permission change.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
    ]);

    const response = await runAgentTurn('run the tests', 'build', { provider });

    assert.equal(response.response, 'Cannot run the blocked command without a permission change.');
    assert.match(getLastUserMessage(calls[1]!), /action\(s\) were blocked/);
    assert.match(getLastUserMessage(calls[1]!), /run_command/);
  });
});

test('runAgentTurn asks for a reread after failed mutation attempts', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'edit_file',
          args: {
            filePath: 'src/app.ts',
            oldText: 'missing',
            newText: 'replacement',
          },
          succeeded: false,
          failureKind: 'tool_error',
          error: 'Exact text to replace was not found in src/app.ts',
        }],
      },
      {
        text: 'I reread src/app.ts and the requested edit remains blocked by the missing text.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
    ]);

    const response = await runAgentTurn('edit src/app.ts', 'build', { provider });

    assert.match(response.response, /requested edit remains blocked/);
    assert.match(getLastUserMessage(calls[1]!), /attempted file change failed/);
    assert.match(getLastUserMessage(calls[1]!), /src\/app\.ts/);
  });
});

test('runAgentTurn requires read-back verification after mutations', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'edit_file',
          args: {
            filePath: 'src/app.ts',
            oldText: 'before',
            newText: 'after',
          },
          succeeded: true,
        }],
      },
      {
        text: 'Updated src/app.ts and read it back.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'read_file',
          args: { filePath: 'src/app.ts' },
          succeeded: true,
        }],
      },
    ]);

    const response = await runAgentTurn('update src/app.ts', 'build', { provider });

    assert.equal(response.response, 'Updated src/app.ts and read it back.');
    assert.match(getLastUserMessage(calls[1]!), /changed file\(s\) but did not verify/i);
    assert.match(getLastUserMessage(calls[1]!), /src\/app\.ts/);
  });
});

test('runAgentTurn reruns verification commands after later mutations', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'npm test' },
          succeeded: true,
        }],
      },
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [
          {
            toolName: 'edit_file',
            args: {
              filePath: 'src/app.ts',
              oldText: 'before',
              newText: 'after',
            },
            succeeded: true,
          },
          {
            toolName: 'read_file',
            args: { filePath: 'src/app.ts' },
            succeeded: true,
          },
        ],
      },
      {
        text: 'Reran npm test after the file change.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'npm test' },
          succeeded: true,
        }],
      },
    ]);

    const response = await runAgentTurn('update src/app.ts and test it', 'build', { provider });

    assert.equal(response.response, 'Reran npm test after the file change.');
    assert.match(getLastUserMessage(calls[2]!), /Run the verification command\(s\) again/);
    assert.match(getLastUserMessage(calls[2]!), /npm test/);
  });
});

test('runAgentTurn asks for a summary when provider tool rounds hit their limit', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'tool_round_limit_reached',
        executedToolCalls: [],
      },
      {
        text: 'Latest work summarized after the tool round limit.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
    ]);

    const response = await runAgentTurn('summarize the current state', 'build', { provider });

    assert.equal(response.response, 'Latest work summarized after the tool round limit.');
    assert.match(getLastUserMessage(calls[1]!), /requested changes are already applied and verified/i);
  });
});
