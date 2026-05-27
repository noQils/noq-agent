import blessed from 'blessed';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from './sessionStore';
import { runSessionTurn } from './sessionTurnRunner';

type SessionEntryKind = 'user' | 'assistant' | 'system';

interface SessionEntry {
  kind: SessionEntryKind;
  text: string;
}

type ScreenInputResult =
  | { kind: 'submit'; line: string }
  | { kind: 'exit' };

function printSessionContinuationHint(sessionId: string): void {
  console.log(`To continue this conversation use: noq --session ${sessionId}`);
}

function buildTranscript(entries: SessionEntry[]): string {
  if (entries.length === 0) {
    return 'Conversation started. Type a message or use /exit to leave the session.';
  }

  return entries
    .map((entry) => {
      if (entry.kind === 'user') {
        return `You\n${entry.text}`;
      }

      if (entry.kind === 'assistant') {
        return `Agent\n${entry.text}`;
      }

      return `System\n${entry.text}`;
    })
    .join('\n\n');
}

function buildStatusLine(sessionId: string, mode: AgentMode): string {
  return ` Session: ${sessionId} | Mode: ${mode} `;
}

function buildHelpLine(): string {
  return ' /mode plan | /mode build | /plan show | /diff | /undo | /exit ';
}

function printModeChange(mode: AgentMode): string {
  return `Switched to ${mode} mode.`;
}

function printModeCommandError(): string {
  return 'Usage: /mode plan or /mode build';
}

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

function readTuiInput(
  sessionId: string,
  mode: AgentMode,
  entries: SessionEntry[],
): Promise<ScreenInputResult> {
  return new Promise((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: `noq-agent ${sessionId}`,
      dockBorders: true,
    });

    let settled = false;

    const finish = (result: ScreenInputResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      screen.destroy();
      resolve(result);
    };

    const statusBar = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: false,
      style: {
        fg: 'black',
        bg: 'cyan',
      },
      content: buildStatusLine(sessionId, mode),
    });

    const transcriptBox = blessed.box({
      parent: screen,
      top: 1,
      left: 0,
      width: '100%',
      bottom: 4,
      border: 'line',
      label: ' Conversation ',
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: {
          inverse: true,
        },
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
      content: buildTranscript(entries),
      padding: {
        left: 1,
        right: 1,
      },
    });

    const inputBox = blessed.textbox({
      parent: screen,
      bottom: 1,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' Message ',
      inputOnFocus: true,
      mouse: true,
      keys: true,
      style: {
        border: {
          fg: 'cyan',
        },
        focus: {
          border: {
            fg: 'green',
          },
        },
      },
      padding: {
        left: 1,
        right: 1,
      },
    });

    blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      style: {
        fg: 'black',
        bg: 'white',
      },
      content: buildHelpLine(),
    });

    transcriptBox.setScrollPerc(100);
    inputBox.focus();

    screen.key(['C-c'], () => {
      finish({ kind: 'exit' });
    });

    screen.key(['pageup'], () => {
      transcriptBox.scroll(-10);
      screen.render();
    });

    screen.key(['pagedown'], () => {
      transcriptBox.scroll(10);
      screen.render();
    });

    inputBox.key('enter', () => {
      inputBox.submit();
    });

    inputBox.on('submit', (value) => {
      finish({
        kind: 'submit',
        line: value,
      });
    });

    statusBar.setFront();
    screen.render();
  });
}

function appendEntry(entries: SessionEntry[], kind: SessionEntryKind, text: string): void {
  entries.push({
    kind,
    text,
  });
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function appendCommandResult(
  entries: SessionEntry[],
  command: () => Promise<string> | string,
): Promise<void> {
  try {
    const result = await command();
    appendEntry(entries, 'system', result);
  } catch (error) {
    appendEntry(entries, 'system', `Command failed: ${formatErrorMessage(error)}`);
  }
}

export async function startInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  let mode = initialMode;
  const entries: SessionEntry[] = [];

  while (true) {
    const promptResult = await readTuiInput(sessionId, mode, entries);

    if (promptResult.kind === 'exit') {
      console.log('');
      printSessionContinuationHint(sessionId);
      return;
    }

    const rawInput = promptResult.line;
    const userInput = rawInput.trim();
    if (userInput.length === 0) {
      continue;
    }

    appendEntry(entries, 'user', rawInput);

    if (userInput === '/exit' || userInput === '/quit') {
      printSessionContinuationHint(sessionId);
      return;
    }

    if (userInput === '/diff') {
      await appendCommandResult(entries, () => getLatestSessionDiff(sessionId));
      continue;
    }

    if (userInput === '/undo') {
      await appendCommandResult(entries, () => undoLastSessionSnapshot(sessionId));
      continue;
    }

    if (userInput === '/plan show') {
      await appendCommandResult(entries, () => formatLatestSessionPlan(sessionId));
      continue;
    }

    if (isModeCommand(userInput)) {
      const requestedMode = userInput.slice('/mode'.length).trim();
      if (!isAgentMode(requestedMode)) {
        appendEntry(entries, 'system', printModeCommandError());
        continue;
      }

      mode = requestedMode;
      appendEntry(entries, 'system', printModeChange(mode));
      continue;
    }

    try {
      const { response } = await runSessionTurn(sessionId, rawInput, mode);
      appendEntry(entries, 'assistant', response);
    } catch (error) {
      appendEntry(entries, 'system', `Turn failed: ${formatErrorMessage(error)}`);
    }
  }
}
