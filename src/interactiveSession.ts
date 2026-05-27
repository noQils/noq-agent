import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

import { isAgentMode, type AgentMode } from './agentMode';
import { formatLatestSessionPlan, getLatestSessionDiff, undoLastSessionSnapshot } from './sessionStore';
import { runSessionTurn } from './sessionTurnRunner';

type PromptResult =
  | { kind: 'line'; line: string }
  | { kind: 'sigint' }
  | { kind: 'eof' };

function buildPrompt(sessionId: string, mode: AgentMode): string {
  return `${sessionId} [${mode}]> `;
}

function printSessionContinuationHint(sessionId: string): void {
  console.log(`To continue this conversation use: noq --session ${sessionId}`);
}

function readPromptLine(prompt: string): Promise<PromptResult> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    let settled = false;

    const finish = (result: PromptResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      rl.removeListener('SIGINT', handleSigint);
      rl.removeListener('close', handleClose);
      rl.close();
      resolve(result);
    };

    const handleSigint = (): void => {
      finish({ kind: 'sigint' });
    };

    const handleClose = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      rl.removeListener('SIGINT', handleSigint);
      rl.removeListener('close', handleClose);
      resolve({ kind: 'eof' });
    };

    rl.on('SIGINT', handleSigint);
    rl.on('close', handleClose);
    rl.question(prompt, (line) => {
      if (settled) {
        return;
      }

      settled = true;
      rl.removeListener('SIGINT', handleSigint);
      rl.removeListener('close', handleClose);
      rl.close();
      resolve({ kind: 'line', line });
    });
  });
}

function printModeChange(mode: AgentMode): void {
  console.log(`Switched to ${mode} mode.`);
}

function printModeCommandError(): void {
  console.log('Usage: /mode plan or /mode build');
}

function isModeCommand(inputLine: string): boolean {
  return inputLine === '/mode' || inputLine.startsWith('/mode ');
}

export async function startInteractiveSession(
  sessionId: string,
  initialMode: AgentMode,
): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Interactive session mode requires a TTY.');
  }

  let mode = initialMode;

  while (true) {
    const promptResult = await readPromptLine(buildPrompt(sessionId, mode));

    if (promptResult.kind === 'sigint' || promptResult.kind === 'eof') {
      console.log('');
      printSessionContinuationHint(sessionId);
      return;
    }

    const userInput = promptResult.line.trim();
    if (userInput.length === 0) {
      continue;
    }

    if (userInput === '/exit' || userInput === '/quit') {
      printSessionContinuationHint(sessionId);
      return;
    }

    if (userInput === '/diff') {
      console.log(getLatestSessionDiff(sessionId));
      continue;
    }

    if (userInput === '/undo') {
      console.log(undoLastSessionSnapshot(sessionId));
      continue;
    }

    if (userInput === '/plan show') {
      console.log(formatLatestSessionPlan(sessionId));
      continue;
    }

    if (isModeCommand(userInput)) {
      const requestedMode = userInput.slice('/mode'.length).trim();
      if (!isAgentMode(requestedMode)) {
        printModeCommandError();
        continue;
      }

      mode = requestedMode;
      printModeChange(mode);
      continue;
    }

    const { response } = await runSessionTurn(sessionId, promptResult.line, mode);
    console.log(response);
  }
}
