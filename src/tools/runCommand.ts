import { InternalTool } from './index';
import { checkIsDirectory } from '../fileUtils';
import { execSync } from 'node:child_process';

type CommandSafety = 'trusted' | 'untrusted' | 'dangerous';

const TRUSTED_COMMANDS = new Set([
    'npx tsc --noEmit',
    'npm test',
    'npm run build',
]);

const DANGEROUS_PATTERNS = [
    /rm\s+-rf/i,
    /\brmdir\b.*\/s/i,
    /\bdel\b.*\/s/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
];

function classifyCommand(command: string): CommandSafety {
    const normalized = command.trim();

    if (TRUSTED_COMMANDS.has(normalized)) {
        return 'trusted';
    }

    if (DANGEROUS_PATTERNS.some(pattern => pattern.test(normalized))) {
        return 'dangerous';
    }

    return 'untrusted';
}

// Define the run_command tool
export const runCommandTool: InternalTool = {
    name: 'run_command',
    description: 'Run a trusted command and return the output. Untrusted or dangerous commands are rejected.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The command to run',
                required: true,
            },
            cwd: {
                type: 'string',
                description: 'The working directory to run the command in',
                nullable: true,
            },
        },
    },
    
    execute: (args: { command: string, cwd?: string }) => {
        const result = runCommand(args.command, args.cwd);
        return result;
    },
};

// Function to run a command
export function runCommand(command: string, cwd?: string) {
    const safety = classifyCommand(command);
    if (safety === 'untrusted') {
        throw new Error(`Command is not trusted: ${command}`);
    }
    if (safety === 'dangerous') {
        throw new Error(`Dangerous command is not allowed: ${command}`);
    }

    if (cwd && !checkIsDirectory(cwd)) {
        throw new Error(`${cwd} is not a directory`);
    }
    
    try {
        const result = execSync(command, { cwd: cwd ?? process.cwd(), encoding: 'utf-8' });
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Command ${command} failed: ${message}`);
    }
}