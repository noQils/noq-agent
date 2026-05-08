import fs from 'node:fs';
import path from 'node:path';

export function readFileIfExists(filePath: string): string | null {
  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, 'utf-8');
  }
  return null;
}