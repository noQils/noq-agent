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

const ignoredPatterns = [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
];

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
    if (query.length === 0 || maxResults <= 0) {
        return [];
    }

    const root = cwd ?? process.cwd();
    const entries = await fg(include, {
        cwd: root,
        dot: true,
        onlyFiles: true,
        ignore: ignoredPatterns,
    });

    const results: GrepResult[] = [];

    for (const entry of entries) {
        const fullPath = path.join(root, entry);
        let content: string; 
        
        try {
            content = await readFile(fullPath, "utf-8");
        } catch {
            continue;
        }

        if (!content.includes(query)) {
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
                    return results;
                }
            }
        }
    }

    return results;
}
