import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { hasPersistentPermissionSession } from './approvals';
import { emitPermissionPromptClosed, emitPermissionPromptOpened } from './promptEvents';
import { type PermissionRequest } from './types';

export type PermissionPromptDecision =
  | 'allow_once'
  | 'allow_session'
  | 'deny';

export type PermissionPromptHandler = (
  request: PermissionRequest,
) => Promise<PermissionPromptDecision>;

let permissionPromptHandler: PermissionPromptHandler | null = null;

export function setPermissionPromptHandler(handler: PermissionPromptHandler): void {
  permissionPromptHandler = handler;
}

export function resetPermissionPromptHandler(): void {
  permissionPromptHandler = null;
}

function buildPermissionPrompt(request: PermissionRequest): string {
  const persistentSessionLabel = hasPersistentPermissionSession()
    ? 'always for this named session'
    : 'always for this run';

  return [
    '',
    `Permission required for ${request.toolName}`,
    `Scope: ${request.scope}`,
    `Target: ${request.target || '(no target)'}`,
    `Choose: allow once [o], ${persistentSessionLabel} [a], or deny [n] (default): `,
  ].join('\n');
}

export async function promptForPermission(request: PermissionRequest): Promise<PermissionPromptDecision> {
  if (permissionPromptHandler) {
    return permissionPromptHandler(request);
  }

  if (!input.isTTY || !output.isTTY) {
    return 'deny';
  }

  emitPermissionPromptOpened(request);
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(buildPermissionPrompt(request));
    const normalizedAnswer = answer.trim().toLowerCase();
    if (
      normalizedAnswer === 'a'
      || normalizedAnswer === 'always'
      || normalizedAnswer === 'session'
    ) {
      return 'allow_session';
    }

    if (
      normalizedAnswer === 'o'
      || normalizedAnswer === 'once'
      || normalizedAnswer === 'y'
      || normalizedAnswer === 'yes'
    ) {
      return 'allow_once';
    }

    return 'deny';
  } finally {
    rl.close();
    emitPermissionPromptClosed(request);
  }
}
