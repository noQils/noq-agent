import { InternalTool } from './index';
import { checkPathExists, readFileContent, writeFileContent } from '../fileUtils';

// Define the edit_file tool
export const editFileTool: InternalTool = {
    // Tool metadata
    name: "edit_file",
    description: "Replace an exact text snippet in a file. Prefer the smallest unique snippet necessary for the intended change.",
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

// Function to edit a file at the specified path
export function editFile(filePath: string, oldText: string, newText: string) {
    if (!checkPathExists(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    if (oldText.length === 0) {
        throw new Error('oldText must not be empty');
    }

    const content = readFileContent(filePath);
    const newline = detectNewline(content);

    const normalizedOldText = normalizeNewlines(oldText, newline);
    const normalizedNewText = normalizeNewlines(newText, newline);

    const occurrences = content.split(normalizedOldText).length - 1;
    if (occurrences === 0) {
        throw new Error(`Exact text to replace was not found in ${filePath}`);
    }

    if (occurrences > 1) {
        throw new Error(`Exact text to replace matched ${occurrences} times in ${filePath}; provide a more specific snippet.`);
    }

    const updatedContent = content.replace(normalizedOldText, normalizedNewText);
    writeFileContent(filePath, updatedContent);

    const verifiedContent = readFileContent(filePath);
    if (verifiedContent !== updatedContent) {
        throw new Error(`Post-write verification failed for ${filePath}`);
    }

    return `Updated ${filePath} by replacing 1 exact text match.`;
}