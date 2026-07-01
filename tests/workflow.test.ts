import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentTurn } from '../src/workflow';
import { replaceTodoItems } from '../src/todoState';
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

test('runAgentTurn does not finalize a capped build response while todos are unfinished', async () => {
  await withTempWorkspace(async () => {
    const calls: ChatMessage[][] = [];
    let callIndex = 0;
    const provider: Provider = {
      async chat(messages) {
        calls.push(messages);
        callIndex++;

        if (callIndex === 1) {
          replaceTodoItems([
            { status: 'in_progress', content: 'Finish the implementation' },
            { status: 'pending', content: 'Run verification' },
          ]);

          return {
            text: 'Done.',
            stopReason: 'tool_round_limit_reached',
            executedToolCalls: [],
          };
        }

        if (callIndex === 2) {
          replaceTodoItems([
            { status: 'completed', content: 'Finish the implementation' },
            { status: 'completed', content: 'Run verification' },
          ]);

          return {
            text: 'Finished after completing the todo list.',
            stopReason: 'no_tool_calls',
            executedToolCalls: [],
          };
        }

        throw new Error(`Unexpected provider call ${callIndex}.`);
      },
    };

    const response = await runAgentTurn('finish all tracked work', 'build', { provider });

    assert.equal(response.response, 'Finished after completing the todo list.');
    assert.match(getLastUserMessage(calls[1]!), /todo list still contains pending or in-progress work/i);
  });
});

test('runAgentTurn does not finalize a capped build response while verification needs rerun', async () => {
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
        text: 'Done.',
        stopReason: 'tool_round_limit_reached',
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
        text: 'Reran verification and finished.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'npm test' },
          succeeded: true,
        }],
      },
    ]);

    const response = await runAgentTurn('update src/app.ts and test it', 'build', { provider });

    assert.equal(response.response, 'Reran verification and finished.');
    assert.match(getLastUserMessage(calls[2]!), /Run the verification command\(s\) again/);
    assert.match(getLastUserMessage(calls[2]!), /npm test/);
  });
});

test('runAgentTurn continues past the old build flow round limit until final text', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'echo first' },
          succeeded: true,
        }],
      },
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'echo second' },
          succeeded: true,
        }],
      },
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'echo third' },
          succeeded: true,
        }],
      },
      {
        text: '',
        stopReason: 'no_tool_calls',
        executedToolCalls: [{
          toolName: 'run_command',
          args: { command: 'echo fourth' },
          succeeded: true,
        }],
      },
      {
        text: 'Final response after more than three build flow rounds.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
    ]);

    const response = await runAgentTurn('keep working until final text', 'build', { provider });

    assert.equal(response.response, 'Final response after more than three build flow rounds.');
    assert.equal(calls.length, 5);
  });
});

test('runAgentTurn rewrites a false denial of recorded prior tool usage', async () => {
  await withTempWorkspace(async () => {
    const { calls, provider } = createSequenceProvider([
      {
        text: 'I didn’t actually use a tool in that last reply. I was relying on an assumption.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
      {
        text: 'I did use a tool in that earlier turn: the recorded session facts show `list_dir(dirPath=".")` succeeded while the working directory was `C:\\Users\\TUF\\Downloads`.',
        stopReason: 'no_tool_calls',
        executedToolCalls: [],
      },
    ]);

    const response = await runAgentTurn('what tools did you use to get that file list?', 'build', {
      provider,
      historyMessages: [
        {
          role: 'user',
          content: 'tell me the files that are in this directory',
        },
        {
          role: 'model',
          content: 'Here are the files and folders in the current directory...',
        },
        {
          role: 'system',
          content: 'Recorded turn facts: working directory was "C:\\Users\\TUF\\Downloads". recorded tool calls: list_dir(dirPath=".") succeeded.',
        },
      ],
    });

    assert.match(response.response, /I did use a tool/i);
    assert.match(response.response, /list_dir\(dirPath="\."\)/);
    assert.match(getLastUserMessage(calls[1]!), /contradicted the recorded session facts/i);
    assert.match(getLastUserMessage(calls[1]!), /Recorded turn facts:/i);
  });
});
