import fg from 'fast-glob';
import { InternalTool } from './index';

const disallowedPatterns = new Set([
    '**',
    '**/*',
    'src/**',
    './**',
])

// Check if a glob pattern is too broad
function isBroadGlob(pattern: string, cwd?: string): boolean {
    const isRootLike = !cwd || cwd === '.';
    const isRecursive = pattern.includes('**');
    const isCatchAll =
        pattern === '**' ||
        pattern === '**/*' ||
        pattern.endsWith('/**') ||
        pattern.endsWith('/**/*');

    const stripped = pattern.replace(/\*\*/g, '').replace(/\*/g, '').trim();
    const hasMeaningfulFilter = stripped.length >= 2 || /\.[a-zA-Z0-9]+/.test(pattern);

    if (isCatchAll) {
        return true;
    }

    if (isRootLike && isRecursive && !hasMeaningfulFilter) {
        return true;
    }

    return false;
}

// Define the glob tool, which searches for files using a glob pattern
export const globTool: InternalTool = {
    // Tool metadata
    name: "glob",
    description: "Find files by pattern. Use narrow, specific patterns whenever possible. Prefer list_dir for general directory inspection, and avoid broad recursive patterns that scan most of the project.",
    parameters: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'The glob pattern to use',
                required: true,
            },
            cwd: {
                type: 'string',
                description: 'The directory to search in',
                required: false,
                nullable: true,
            },
        },
    },

    execute: async (args: {pattern: string, cwd?: string}) => {
        const results = await glob(args.pattern, args.cwd);
        return JSON.stringify(results);
    }
}

// Search for files using a glob pattern
export async function glob(pattern: string, cwd?: string): Promise<string[]> {
    const normalizedPattern = pattern.trim();
    const normalizedCwd = cwd?.trim();
    if (disallowedPatterns.has(pattern) || isBroadGlob(normalizedPattern, normalizedCwd)) {
        throw new Error(`Glob pattern is too broad: ${normalizedPattern}. Use a narrower pattern or inspect directories with list_dir first.`);
    }

    const entries = await fg(pattern, {
        cwd: cwd ?? process.cwd(),
        dot: true,
        ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
    })

    return entries;
};