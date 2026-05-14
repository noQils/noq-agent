import fg from 'fast-glob';
import { Tool } from './index';

// Define the glob tool, which searches for files using a glob pattern
export const globTool: Tool = {
    // Tool metadata
    name: "glob",
    description: "Search for files using a glob pattern",
    parameters: {
        type: "object",
        properties: {
            pattern: {
                type: "string",
                description: "The glob pattern to use",
            },
            cwd: {
                type: "string",
                description: "The directory to search in",
            },
        },
        required: ["pattern"],
    },
    execute: async (args: {pattern: string, cwd?: string}) => {
        const results = await glob(args.pattern, args.cwd);
        return JSON.stringify(results);
    }
}

// Search for files using a glob pattern
export async function glob(pattern: string, cwd?: string): Promise<string[]> {
    const entries =  await fg(pattern, {
        cwd: cwd ?? process.cwd(),
        dot: true,
    })

    return entries;
};