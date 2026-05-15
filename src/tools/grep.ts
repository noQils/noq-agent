import fg from 'fast-glob';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { InternalTool } from './index';

// Result of a grep search
type GrepResult = {
    file: string;
    line: number;
    text: string;
};

// Define the grep tool, which searches for a pattern in a directory
export const grepTool: InternalTool = {
    // Tool metadata
    name: "grep",
    description: "Search for a pattern in a directory",
    parameters: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The pattern to search for",
                required: true,
            },
            cwd: {
                type: "string",
                description: "The directory to search in",
                required: false,
                nullable: true,
            },
        },
    },

    execute: async (args: {query: string, cwd?: string}) => {
        const results = await grep(args.query, args.cwd);
        return JSON.stringify(results);
    }
}

// Search for a pattern in a directory
export async function grep(
    query: string,
    cwd?: string,
    include = "**/*",
    maxResults = 100,
): Promise<GrepResult[]> {
    const entries = await fg(include, {
        cwd: cwd ?? process.cwd(),
        dot: true,
        onlyFiles: true,
        ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
    });

    const results: GrepResult[] = [];

    for (const entry of entries) {
        const fullPath = path.join(cwd ?? process.cwd(), entry);
        let content: string; 
        
        try {
            content = await readFile(fullPath, "utf-8");
        } catch {
            continue;
        }

        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line?.includes(query)) {
                results.push({
                    file: entry,
                    line: i + 1,
                    text: line,
                });

                if (results.length >= maxResults) {
                    break;
                }
            }
        }
    }

    return results;
}