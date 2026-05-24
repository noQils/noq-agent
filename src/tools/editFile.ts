import { InternalTool } from './index';
import { readFileContent, writeFileContent } from '../fileUtils';

// Define the edit_file tool
export const editFileTool: InternalTool = {
    // Tool metadata
    name: "edit_file",
    description: "Replace an exact text snippet in a file. Prefer the smallest unique snippet necessary for the intended change.",
    allowedModes: ['build'],
    permission: {
        scope: 'edit',
        getTarget: (args) => typeof args.filePath === 'string' ? args.filePath : '',
    },
    parameters: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: "The path to the file to edit",
                required: true,
            },
            oldText: {
                type: 'string',
                description: "The text to replace",
                required: true,
            },
            newText: {
                type: 'string',
                description: "The text to replace with",
                required: true,
            },
        },
    },
    
    execute: (args: { filePath: string, oldText: string, newText: string }) => {
        const result = editFile(args.filePath, args.oldText, args.newText);
        return result;
    },
};

function detectNewline(content: string): '\r\n' | '\n' {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeNewlines(text: string, newline: '\r\n' | '\n'): string {
    return text.replace(/\r?\n/g, newline);
}

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLineEndingAgnosticPattern(text: string): RegExp {
    const escapedLines = text.split(/\r\n|\n|\r/).map(escapeRegex);
    return new RegExp(escapedLines.join('\\r?\\n'), 'g');
}

function findUniqueMatch(content: string, oldText: string): { index: number; length: number } | null {
    const firstIndex = content.indexOf(oldText);
    if (firstIndex !== -1) {
        const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
        if (secondIndex !== -1) {
            return null;
        }

        return { index: firstIndex, length: oldText.length };
    }

    const matches = Array.from(content.matchAll(buildLineEndingAgnosticPattern(oldText)));
    if (matches.length !== 1) {
        return null;
    }

    const match = matches[0];
    if (match?.index === undefined || match[0] === undefined) {
        return null;
    }

    return { index: match.index, length: match[0].length };
}

function countMatches(content: string, oldText: string): number {
    const exactMatchCount = content.split(oldText).length - 1;
    if (exactMatchCount > 0) {
        return exactMatchCount;
    }

    return Array.from(content.matchAll(buildLineEndingAgnosticPattern(oldText))).length;
}

// Function to edit a file at the specified path
export function editFile(filePath: string, oldText: string, newText: string) {
    if (oldText.length === 0) {
        throw new Error('oldText must not be empty');
    }

    let content: string;
    try {
        content = readFileContent(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`File not found: ${filePath}`);
        }

        throw error;
    }

    const newline = detectNewline(content);

    const normalizedOldText = normalizeNewlines(oldText, newline);
    const normalizedNewText = normalizeNewlines(newText, newline);

    if (normalizedOldText === normalizedNewText) {
        throw new Error('newText must be different from oldText');
    }

    const match = findUniqueMatch(content, normalizedOldText);
    if (!match) {
        const occurrences = countMatches(content, normalizedOldText);
        if (occurrences > 1) {
            throw new Error(`Exact text to replace matched ${occurrences} times in ${filePath}; provide a more specific snippet.`);
        }

        throw new Error(`Exact text to replace was not found in ${filePath}`);
    }

    const updatedContent =
        content.slice(0, match.index) +
        normalizedNewText +
        content.slice(match.index + match.length);
    writeFileContent(filePath, updatedContent);

    const verifiedContent = readFileContent(filePath);
    if (verifiedContent !== updatedContent) {
        throw new Error(`Post-write verification failed for ${filePath}`);
    }

    return `Updated ${filePath} by replacing 1 exact text match.`;
}
