import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendSessionTurn,
  buildSessionHistoryMessages,
  generateUniqueSessionId,
  getLatestSessionDiff,
  getSessionDebugLogPath,
  getSessionFilePath,
  getSessionPermissionApprovals,
  loadExistingSession,
  loadOrCreateSession,
  undoLastSessionSnapshot,
} from '../src/sessionStore';
import {
  allowPermissionForSession,
  isPermissionPreApproved,
  resetPermissionApprovalState,
  setPermissionApprovalSession,
} from '../src/permissions/approvals';
import { withTempWorkspace } from './helpers/tempWorkspace';

async function withTempNoqHome<T>(callback: () => Promise<T> | T): Promise<T> {
  const previousNoqHome = process.env.NOQ_HOME;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noq-agent-session-home-test-'));

  process.env.NOQ_HOME = path.join(root, '.noq-home');

  try {
    return await callback();
  } finally {
    if (previousNoqHome === undefined) {
      delete process.env.NOQ_HOME;
    } else {
      process.env.NOQ_HOME = previousNoqHome;
    }

    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('session ids reject path traversal characters', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      assert.throws(
        () => loadOrCreateSession('../outside'),
        /Session id may contain only letters/,
      );
      assert.throws(
        () => loadOrCreateSession('.'),
        /Session id may contain only letters/,
      );
      assert.throws(
        () => loadOrCreateSession('..'),
        /Session id may contain only letters/,
      );
    });
  });
});

test('new sessions are stored in a per-session directory', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      const session = loadOrCreateSession('folder-session');

      assert.equal(session.id, 'folder-session');
      assert.equal(session.workspaceRoot, workspace.root);
      assert.equal(
        getSessionFilePath('folder-session'),
        path.join(process.env.NOQ_HOME!, 'sessions', 'folder-session', 'session.json'),
      );
      assert.equal(
        getSessionDebugLogPath('folder-session'),
        path.join(process.env.NOQ_HOME!, 'sessions', 'folder-session', 'debug.log'),
      );
      assert.equal(fs.existsSync(getSessionFilePath('folder-session')), true);
    });
  });
});

test('generated session ids avoid existing session directories', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      fs.mkdirSync(path.join(process.env.NOQ_HOME!, 'sessions', 'session-20260101-000000'), { recursive: true });
      fs.writeFileSync(
        path.join(process.env.NOQ_HOME!, 'sessions', 'session-20260101-000000', 'session.json'),
        JSON.stringify({ id: 'session-20260101-000000' }),
        'utf-8',
      );
      fs.mkdirSync(path.join(process.env.NOQ_HOME!, 'sessions', 'session-20260101-000000-2'), { recursive: true });
      fs.writeFileSync(
        path.join(process.env.NOQ_HOME!, 'sessions', 'session-20260101-000000-2', 'session.json'),
        JSON.stringify({ id: 'session-20260101-000000-2' }),
        'utf-8',
      );

      assert.equal(
        generateUniqueSessionId(new Date(2026, 0, 1, 0, 0, 0)),
        'session-20260101-000000-3',
      );
    });
  });
});

test('buildSessionHistoryMessages compacts older turns and keeps recent turns verbatim', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      for (let index = 1; index <= 8; index++) {
        appendSessionTurn(
          'history-session',
          {
            timestamp: `2026-01-01T00:00:0${index}.000Z`,
            mode: 'build',
            userPrompt: `prompt ${index}`,
            response: `response ${index}`,
          },
          [],
        );
      }

      const messages = buildSessionHistoryMessages(loadOrCreateSession('history-session'));

      assert.equal(messages.length, 13);
      assert.equal(messages[0]?.role, 'system');
      assert.match(messages[0]?.content ?? '', /Earlier session context/);
      assert.match(messages[0]?.content ?? '', /prompt 1/);
      assert.equal(messages[1]?.content, 'prompt 3');
      assert.equal(messages.at(-2)?.content, 'prompt 8');
      assert.equal(messages.at(-1)?.content, 'response 8');
    });
  });
});

test('session snapshots expose diffs and undo restores the before-state', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace((workspace) => {
      workspace.writeFile('src/example.txt', 'after\n');

      appendSessionTurn(
        'snapshot-session',
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          mode: 'build',
          userPrompt: 'update example',
          response: 'updated example',
        },
        [{
          filePath: 'src/example.txt',
          existedBefore: true,
          beforeContent: 'before\n',
          existedAfter: true,
          afterContent: 'after\n',
        }],
      );

      const diff = getLatestSessionDiff('snapshot-session');
      assert.match(diff, /src\/example\.txt/);
      assert.match(diff, /-before/);
      assert.match(diff, /\+after/);

      const undoResponse = undoLastSessionSnapshot('snapshot-session');

      assert.match(undoResponse, /Reverted snapshot/);
      assert.equal(workspace.readFile('src/example.txt'), 'before\n');
      assert.match(
        getLatestSessionDiff('snapshot-session'),
        /No agent-generated file snapshots are recorded/,
      );
    });
  });
});

test('session permission approvals persist across approval state resets', async () => {
  await withTempNoqHome(async () => {
    await withTempWorkspace(() => {
      const request = {
        scope: 'bash' as const,
        toolName: 'run_command',
        target: 'npm test -- --watch=false',
        args: {
          command: 'npm test -- --watch=false',
        },
      };

      setPermissionApprovalSession('approval-session');
      allowPermissionForSession(request);

      assert.equal(isPermissionPreApproved(request), true);
      assert.deepEqual(
        getSessionPermissionApprovals('approval-session').map((approval) => ({
          scope: approval.scope,
          targetPattern: approval.targetPattern,
        })),
        [{
          scope: 'bash',
          targetPattern: 'npm test -- --watch=false',
        }],
      );

      resetPermissionApprovalState();
      setPermissionApprovalSession('approval-session');

      assert.equal(isPermissionPreApproved(request), true);
    });
  });
});
