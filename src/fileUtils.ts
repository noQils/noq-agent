import fs from 'node:fs';
import path from 'node:path';

export function checkPathExists(filePath: string): boolean {
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

export function ensureParentDirectory(filePath: string) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
}

export function scanDirectory(dirPath: string): string[] {
  const resolvedPath = path.resolve(process.cwd(), dirPath);
  const files = fs.readdirSync(resolvedPath);
  return files.map((file) => path.join(resolvedPath, file));
}

export function checkIsDirectory(filePath: string): boolean {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return fs.statSync(resolvedPath).isDirectory();
}

export function getBaseName(filePath: string): string {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  return path.basename(resolvedPath);
}