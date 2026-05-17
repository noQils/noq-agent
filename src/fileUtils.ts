import fs from 'node:fs';
import path from 'node:path';

export function fileExists(filePath: string): boolean {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.existsSync(resolvedPath);
}

export function readFileContent(filePath: string): string {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(resolvedPath, 'utf-8');
}

export function writeFileContent(filePath: string, content: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.writeFileSync(resolvedPath, content, 'utf-8');
}