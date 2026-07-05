import { spawnSync } from 'node:child_process';

import { InternalTool } from './index';

const maxOutputChars = 20_000;
const truncationMarker = '\n...[truncated]';

function truncate(text: string): string {
    if (text.length <= maxOutputChars) {
        return text;
    }

    return text.slice(0, maxOutputChars) + truncationMarker;
}

function runGit(args: string[], cwd: string | undefined): string {
    const result = spawnSync('git', args, {
        cwd: cwd ?? process.cwd(),
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
        throw new Error('git is not installed or not on PATH.');
    }

    if (result.status !== 0) {
        const stderr = result.stderr?.trim();
        throw new Error(stderr.length > 0 ? stderr : `git ${args.join(' ')} failed with exit code ${result.status}`);
    }

    return result.stdout;
}

export async function gitStatus(cwd?: string): Promise<string> {
    const output = runGit(['status', '--porcelain=v1', '--branch'], cwd).trimEnd();
    const lines = output.split('\n');
    const [branchLine, ...changeLines] = lines;

    if (changeLines.length === 0) {
        return `${branchLine}\nWorking tree clean.`;
    }

    return output;
}

export async function gitDiff(options: { path?: string | undefined; staged?: boolean | undefined } = {}): Promise<string> {
    const args = ['diff'];

    if (options.staged) {
        args.push('--staged');
    }

    if (options.path) {
        args.push('--', options.path);
    }

    const output = runGit(args, undefined).trim();

    if (output.length === 0) {
        return 'No changes.';
    }

    return truncate(output);
}

export const gitStatusTool: InternalTool = {
    name: 'git_status',
    description: 'Show the working tree status: current branch plus modified, staged, and untracked files.',
    allowedModes: ['plan', 'build'],
    permission: {
        scope: 'git',
        getTarget: () => '',
    },
    parameters: {
        type: 'object',
        properties: {
            cwd: {
                type: 'string',
                description: 'Optional directory to check status in',
                required: false,
                nullable: true,
            },
        },
    },

    execute: async (args: { cwd?: string | null }) => gitStatus(args.cwd ?? undefined),
};

export const gitDiffTool: InternalTool = {
    name: 'git_diff',
    description: 'Show a git diff. Defaults to unstaged changes; set staged to see the index-vs-HEAD diff. Optionally scope to a single file or directory.',
    allowedModes: ['plan', 'build'],
    permission: {
        scope: 'git',
        getTarget: (args) => typeof args.path === 'string' ? args.path : '',
    },
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Optional file or directory to restrict the diff to',
                required: false,
                nullable: true,
            },
            staged: {
                type: 'boolean',
                description: 'Set to true to show staged (index vs HEAD) changes instead of unstaged changes. Defaults to false.',
                required: false,
                nullable: true,
            },
        },
    },

    execute: async (args: { path?: string | null; staged?: boolean | null }) => gitDiff({
        path: args.path ?? undefined,
        staged: args.staged ?? undefined,
    }),
};
