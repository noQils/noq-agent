import fs from 'node:fs';
import path from 'node:path';

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export function resolveProjectPath(filePath: string): string {
  return path.resolve(process.cwd(), filePath);
}

export function checkPathExists(filePath: string): boolean {
  const resolvedPath = resolveProjectPath(filePath);
  return fs.existsSync(resolvedPath);
}

export function readFileContent(filePath: string): string {
  const resolvedPath = resolveProjectPath(filePath);
  return fs.readFileSync(resolvedPath, 'utf-8');
}

export function writeFileContent(filePath: string, content: string) {
  const resolvedPath = resolveProjectPath(filePath);
  fs.writeFileSync(resolvedPath, content, 'utf-8');
}

export function ensureParentDirectory(filePath: string) {
  const resolvedPath = resolveProjectPath(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
}

function readDirectoryEntries(resolvedPath: string): DirectoryEntry[] {
  return fs.readdirSync(resolvedPath, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));
}

export function scanDirectory(dirPath: string): string[] {
  const resolvedPath = resolveProjectPath(dirPath);
  return readDirectoryEntries(resolvedPath).map((entry) => path.join(resolvedPath, entry.name));
}

export function listDirectoryEntries(dirPath: string): DirectoryEntry[] {
  const resolvedPath = resolveProjectPath(dirPath);
  return readDirectoryEntries(resolvedPath);
}

export function checkIsDirectory(filePath: string): boolean {
  const resolvedPath = resolveProjectPath(filePath);
  return fs.statSync(resolvedPath).isDirectory();
}

export function getBaseName(filePath: string): string {
  const resolvedPath = resolveProjectPath(filePath);
  return path.basename(resolvedPath);
}

export function getProjectFilePaths(dirPath = '.'): string[] {
  const resolvedPath = resolveProjectPath(dirPath);
  const ignoredDirectories = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
  ]);
  const filePaths: string[] = [];

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          continue;
        }

        walk(fullPath);
        continue;
      }

      const relativePath = path.relative(process.cwd(), fullPath).replaceAll('\\', '/');
      filePaths.push(relativePath);
    }
  }

  walk(resolvedPath);
  return filePaths;
}
