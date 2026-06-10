import os from 'node:os';
import path from 'node:path';

export function formatWorkspacePathLabel(workspacePath: string): string {
  const normalizedWorkspacePath = path.resolve(workspacePath);
  const homePath = path.resolve(os.homedir());
  const relativeToHome = path.relative(homePath, normalizedWorkspacePath);

  if (relativeToHome.length === 0) {
    return '~';
  }

  if (!relativeToHome.startsWith('..') && !path.isAbsolute(relativeToHome)) {
    return `~\\${relativeToHome}`;
  }

  return normalizedWorkspacePath;
}
