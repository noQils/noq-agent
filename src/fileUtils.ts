import fs from 'node:fs';
import path from 'node:path';

export function readFileIfExists(filePath: string): string | null {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, 'utf-8');
  }
  return null;
}

export function writeFileContent(filePath: string, content: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.writeFileSync(resolvedPath, content);
}