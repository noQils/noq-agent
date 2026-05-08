import fs from 'node:fs';
import path from 'node:path';

export function scanDirectory(dir: string): string[] {
    let results: string[] = [];
    const items = fs.readdirSync(dir);
    items.forEach(item => {
        if (item === 'node_modules' || item === '.git' || item === '.vscode') return;
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(scanDirectory(fullPath));
        } else {
            results.push(fullPath);
        }
    });
    return results;
}