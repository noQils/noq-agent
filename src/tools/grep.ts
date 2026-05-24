import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { checkIsDirectory, checkPathExists } from '../fileUtils';
import { InternalTool } from './index';

type GrepResult = {
    file: string;
    line: number;
    text: string;
};

type RipgrepMatchEvent = {
    type: 'match';
    data?: {
        path?: {
            text?: string;
        };
        lines?: {
            text?: string;
        };
        line_number?: number;
    };
};

const ignoredGlobs = [
    '!node_modules/**',
    '!.git/**',
    '!dist/**',
    '!build/**',
];

const defaultMaxResults = 100;
const maxAllowedResults = 500;

export const grepTool: InternalTool = {
    name: "grep",
    description: "Search with ripgrep. Supports literal or regex search, file filters, and result limits.",
    allowedModes: ['plan', 'build'],
    permission: {
        scope: 'grep',
        getTarget: (args) => typeof args.query === 'string' ? args.query : '',
    },
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The text or regex pattern to search for",
                required: true,
            },
            cwd: {
                type: "string",
                description: "Optional directory to search in",
                required: false,
                nullable: true,
            },
            fileGlob: {
                type: "string",
                description: "Optional file filter such as \"src/**/*.ts\" or \"*.md\"",
                required: false,
                nullable: true,
            },
            regex: {
                type: "boolean",
                description: "Set to true to treat query as a regex. Defaults to false for literal search.",
                required: false,
                nullable: true,
            },
            caseSensitive: {
                type: "boolean",
                description: "Set to false for case-insensitive search. Defaults to true.",
                required: false,
                nullable: true,
            },
            maxResults: {
                type: "integer",
                description: "Maximum number of matches to return. Defaults to 100 and is capped at 500.",
                required: false,
                nullable: true,
            },
        },
    },

    execute: async (args: {
        query: string;
        cwd?: string | null;
        fileGlob?: string | null;
        regex?: boolean | null;
        caseSensitive?: boolean | null;
        maxResults?: number | null;
    }) => {
        const results = await grep(
            args.query,
            args.cwd ?? undefined,
            args.fileGlob ?? undefined,
            args.maxResults ?? undefined,
            args.regex ?? undefined,
            args.caseSensitive ?? undefined,
        );
        return JSON.stringify(results);
    }
}

function normalizeResultPath(root: string, filePath: string): string {
    const normalizedPath = filePath.replaceAll('\\', '/');
    const relativeRoot = path.relative(process.cwd(), root).replaceAll('\\', '/');

    if (relativeRoot.length === 0 || relativeRoot === '.') {
        return normalizedPath;
    }

    return path.posix.join(relativeRoot, normalizedPath);
}

function validateMaxResults(maxResults: number): number {
    if (!Number.isInteger(maxResults) || maxResults < 1) {
        throw new Error('maxResults must be a positive integer.');
    }

    return Math.min(maxResults, maxAllowedResults);
}

function buildRipgrepArgs(
    query: string,
    fileGlob: string | undefined,
    maxResults: number,
    regex: boolean,
    caseSensitive: boolean,
): string[] {
    const args = [
        '--json',
        '--line-number',
        '--color',
        'never',
        '--max-count',
        String(maxResults),
        '--hidden',
        '--no-messages',
    ];

    if (!regex) {
        args.push('--fixed-strings');
    }

    if (!caseSensitive) {
        args.push('--ignore-case');
    }

    for (const ignoredGlob of ignoredGlobs) {
        args.push('--glob', ignoredGlob);
    }

    if (fileGlob) {
        args.push('--glob', fileGlob);
    }

    args.push(query, '.');

    return args;
}

function parseRipgrepOutput(stdout: string, root: string, maxResults: number): GrepResult[] {
    const results: GrepResult[] = [];
    const lines = stdout.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
        const event = JSON.parse(line) as { type?: string };
        if (event.type !== 'match') {
            continue;
        }

        const matchEvent = event as RipgrepMatchEvent;
        const filePath = matchEvent.data?.path?.text;
        const lineNumber = matchEvent.data?.line_number;
        const text = matchEvent.data?.lines?.text;

        if (typeof filePath !== 'string' || typeof lineNumber !== 'number' || typeof text !== 'string') {
            continue;
        }

        results.push({
            file: normalizeResultPath(root, filePath),
            line: lineNumber,
            text: text.replace(/\r?\n$/, ''),
        });

        if (results.length >= maxResults) {
            break;
        }
    }

    return results;
}

export async function grep(
    query: string,
    cwd?: string,
    fileGlob?: string,
    maxResults = defaultMaxResults,
    regex = false,
    caseSensitive = true,
): Promise<GrepResult[]> {
    if (query.length === 0) {
        return [];
    }

    const root = path.resolve(process.cwd(), cwd ?? '.');
    if (!checkPathExists(root)) {
        throw new Error(`Directory not found: ${cwd ?? '.'}`);
    }

    if (!checkIsDirectory(root)) {
        throw new Error(`${cwd ?? '.'} is not a directory`);
    }

    const resolvedMaxResults = validateMaxResults(maxResults);
    const ripgrepArgs = buildRipgrepArgs(
        query,
        fileGlob?.trim() || undefined,
        resolvedMaxResults,
        regex,
        caseSensitive,
    );

    const result = spawnSync('rg', ripgrepArgs, {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
        throw new Error(`Failed to execute ripgrep: ${result.error.message}`);
    }

    if (result.status === 1) {
        return [];
    }

    if (result.status !== 0) {
        const stderr = result.stderr?.trim();
        throw new Error(stderr.length > 0 ? stderr : `ripgrep failed with exit code ${result.status}`);
    }

    return parseRipgrepOutput(result.stdout, root, resolvedMaxResults);
}
