import { InternalTool } from './index';
import { checkIsDirectory } from '../fileUtils';
import { execSync } from 'node:child_process';

const allowedCommands: Set<string> = new Set([
    'npx tsc --noEmit', 
    'npm test', 
    'npm run build'
])

// Define the run_command tool
export const runCommandTool: InternalTool = {
    // Tool metadata
    name: 'run_command',
    description: "Run a command and return the output",
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: "The command to run",
                required: true,
            },
            cwd: {
                type: 'string',
                description: "The current working directory",
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
    if (!allowedCommands.has(command)) {
        throw new Error(`Command ${command} is not allowed`);
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