import fg from 'fast-glob';
import { InternalTool } from './index';

const ignoredPatterns = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
];

const rootDisallowedPatterns = new Set([
    '**',
    '**/*',
    'src/**',
    'src/**/*',
    './**',
    './**/*',
]);

function normalizePattern(pattern: string): string {
    return pattern.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function getLiteralPrefix(pattern: string): string {
    const wildcardIndex = pattern.search(/[*?[{]/);
    const prefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
    return prefix.replace(/[\\/]+$/, '');
}

function countPathSegments(filePath: string): number {
    return filePath.split('/').filter(Boolean).length;
}

// Check whether a glob pattern is too broad
function isBroadGlob(pattern: string, cwd?: string): boolean {
    // Treat root-like recursive patterns as broad
    const isRootLike = !cwd || cwd === '.';
    const isRecursive = pattern.includes('**');
    const literalPrefix = getLiteralPrefix(pattern);
    const isCatchAll =
        pattern === '**' ||
        pattern === '**/*' ||
        pattern.endsWith('/**') ||
        pattern.endsWith('/**/*');

    const stripped = pattern.replaceAll('**', '').replaceAll('*', '').trim();
    const hasMeaningfulFilter = stripped.length >= 2 || /\.[a-zA-Z0-9]+/.test(pattern);

    if (isCatchAll) {
        return isRootLike && countPathSegments(literalPrefix) < 2;
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
    description: "Search for files using a glob pattern. Avoid using too broad patterns.",
    allowedModes: ['plan', 'build'],
    permission: {
        scope: 'glob',
        getTarget: (args) => typeof args.pattern === 'string' ? args.pattern : '',
    },
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
    const normalizedPattern = normalizePattern(pattern);
    const normalizedCwd = cwd?.trim();
    const isRootLike = !normalizedCwd || normalizedCwd === '.';
    if ((isRootLike && rootDisallowedPatterns.has(normalizedPattern)) || isBroadGlob(normalizedPattern, normalizedCwd)) {
        throw new Error(`Glob pattern is too broad: ${normalizedPattern}. Use a narrower pattern or inspect directories with list_dir first.`);
    }

    const entries = await fg(normalizedPattern, {
        cwd: normalizedCwd || process.cwd(),
        dot: true,
        onlyFiles: true,
        ignore: ignoredPatterns,
    })

    return entries;
};
