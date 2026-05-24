import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { type PermissionRequest } from './types';

function buildPermissionPrompt(request: PermissionRequest): string {
  return [
    '',
    `Permission required for ${request.toolName}`,
    `Scope: ${request.scope}`,
    `Target: ${request.target || '(no target)'}`,
    'Allow this action? [y/N]: ',
  ].join('\n');
}

export async function promptForPermission(request: PermissionRequest): Promise<boolean> {
  if (!input.isTTY || !output.isTTY) {
    return false;
  }

  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(buildPermissionPrompt(request));
    const normalizedAnswer = answer.trim().toLowerCase();
    return normalizedAnswer === 'y' || normalizedAnswer === 'yes';
  } finally {
    rl.close();
  }
}
